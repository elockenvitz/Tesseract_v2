/**
 * The producer's row survives the trip into the feed entry.
 *
 * ── The boundary this guards ─────────────────────────────────────────────
 *
 * `AttentionEntry.source` is where a machine-derived candidate's structured
 * row travels, and the target and recommendation families were both added
 * with `source: null`. Everything downstream still looked healthy: the card
 * rendered, the tile ranked, the pane opened the right asset. What was
 * missing was invisible -- the numbers behind the claim, which the workspace
 * needs to say which target was passed and what it was measured against.
 *
 * A rendered test of the pane cannot catch this, because a test builds the
 * entry it renders. This asserts the assembly itself.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const BREACH = {
  assetId: 'a-aapl', symbol: 'AAPL', companyName: 'Apple Inc.',
  price: 272.95, target: 230, overshootPct: (272.95 - 230) / 230,
  caseName: 'Bull',
  cases: [
    { id: 'c-bear', name: 'Bear', price: 150 },
    { id: 'c-base', name: 'Base', price: 195 },
    { id: 'c-bull', name: 'Bull', price: 230 },
  ],
  conviction: 'high',
  heldIn: ['Vision Fund'], heldInIds: ['p-vision'],
  statedAt: '2026-03-04T00:00:00.000Z',
  asOf: '2026-11-07T00:00:00.000Z',
}

const pool = vi.hoisted(() => ({
  lenses: { stale: [], breaches: [] as unknown[], conviction: [], crowded: [] },
}))

vi.mock('../useDesktopCandidates', () => ({
  useDesktopCandidates: () => ({
    lenses: pool.lenses,
    scenarioCards: [], insights: [], feedItems: [], attention: null,
    hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(),
    isLoading: false, lensesLoading: false,
  }),
}))
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'reader-1' } }) }))
vi.mock('../useReadyToRevisit', () => ({
  useReadyToRevisit: () => ({ candidates: [], isLoading: false }),
}))
vi.mock('../useDesktopDecisions', () => ({
  useDecisionScan: () => ({ decisions: [], isLoading: false }),
}))
vi.mock('../mobile/useFeedFacets', async importOriginal => {
  const actual = await importOriginal<typeof import('../mobile/useFeedFacets')>()
  return { ...actual, useFeedFacets: () => ({ data: undefined, isLoading: false }) }
})

import { useDesktopAttentionFeed } from '../useDesktopAttentionFeed'

describe('a target-hit candidate', () => {
  it('carries the lens row that produced it', () => {
    pool.lenses.breaches = [BREACH]
    const { result } = renderHook(() => useDesktopAttentionFeed('all'))

    const entry = result.current.entries.find(e => e.family === 'target_hit')
    expect(entry, 'the feed produced no target_hit entry').toBeTruthy()

    /* The row itself, not a copy of the headline. These five fields are what
       the workspace composes a target review out of; without them it can only
       re-derive the asset's current state. */
    const source = entry!.source as typeof BREACH | null
    expect(source?.target).toBe(230)
    expect(source?.price).toBe(272.95)
    expect(source?.caseName).toBe('Bull')
    expect(source?.statedAt).toBe('2026-03-04T00:00:00.000Z')
    expect(source?.cases?.map(c => c.name)).toEqual(['Bear', 'Base', 'Bull'])
  })
})
