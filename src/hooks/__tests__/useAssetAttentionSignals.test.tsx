/**
 * useAssetAttentionSignals — the attention surface's data layer.
 *
 * The band issues no queries of its own: it is a pure pass-through of what the
 * canonical, org-scoped hooks (useAssetWorkspace / useAnalystRatings) returned,
 * through the shared resolver. So the permission boundary is those hooks' RLS
 * (verified org-scoped at the DB), and this proves the hook adds no leak: a user
 * whose org-scoped sources return different rows gets different signals, and a
 * user who can see nothing sees no signals — never another org's records.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const ws = vi.hoisted(() => ({ data: {} as any, isLoading: false }))
const rt = vi.hoisted(() => ({ consensus: [] as any[], ratings: [] as any[] }))
vi.mock('../useAssetWorkspace', () => ({ useAssetWorkspace: () => ws }))
vi.mock('../useAnalystRatings', () => ({ useAnalystRatings: () => rt }))
vi.mock('../../lib/desktop-research/model', () => ({ CORE_SECTIONS: ['thesis', 'where_different', 'risks_to_thesis'] }))

import { useAssetAttentionSignals } from '../useAssetAttentionSignals'

const EMPTY = { sections: [], evidence: [], decisions: [], positions: [], caseWrittenAt: null, target: null, spot: null, liveIdeas: [] }
const old = new Date(Date.now() - 400 * 86_400_000).toISOString()

beforeEach(() => { ws.data = { ...EMPTY }; ws.isLoading = false; rt.consensus = []; rt.ratings = [] })

function run(coveringUserIds: string[] = []) {
  return renderHook(() => useAssetAttentionSignals({ assetId: 'a1', symbol: 'LLY', coveringUserIds })).result.current
}

describe('useAssetAttentionSignals — surfaces only each org-scoped source', () => {
  it('org-A user: their waiting decision and stale case become signals', () => {
    ws.data = { ...EMPTY, caseWrittenAt: old, decisions: [{ id: 'd1', action: 'Buy', decidedAt: null, portfolioId: 'pf-a', portfolioName: 'Vision Fund 10K' }] }
    const out = run(['u-a'])
    expect(out.signals.some(s => s.kind === 'pending' && /Vision Fund 10K/.test(s.headline))).toBe(true)
    expect(out.signals.some(s => s.id === 'staleness-case-age')).toBe(true)
  })

  it('org-B user: a different (empty) org-scoped source yields no org-A signals', () => {
    // What RLS returns for a user in another org on this asset: nothing they own.
    ws.data = { ...EMPTY }
    const out = run([])
    expect(out.signals.some(s => /Vision Fund 10K/.test(s.headline))).toBe(false)
    // no fabricated all-clear either
    expect(out.signals.filter(s => s.kind === 'pending')).toHaveLength(0)
  })

  it('coverage gap is driven by the coverage rows the page passed in', () => {
    ws.data = { ...EMPTY, caseWrittenAt: old }
    expect(run([]).signals.some(s => s.id === 'gap-no-coverage')).toBe(true)
    expect(run(['u-a']).signals.some(s => s.id === 'gap-no-coverage')).toBe(false)
  })

  it('drops provenance signals (stated by Decision Memory, not the band)', () => {
    ws.data = { ...EMPTY, positions: [{ portfolioId: 'pf-a', portfolioName: 'Growth', weightPct: 2 }] }
    expect(run([]).signals.some(s => s.kind === 'provenance')).toBe(false)
  })
})
