/**
 * After Submit Recommendation, the surfaces that changed must be re-read.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The submit mutation invalidated five keys and TWO OF THEM MATCHED NO
 * QUERY: `trade-ideas` and `trade-queue`. Nothing in the app registers
 * either. They read as though the Ideas surfaces were covered.
 *
 * The key that actually feeds the pipeline tile is `trade-queue-items`,
 * which was never invalidated, sets no `staleTime` of its own (so inherits
 * the 5-minute global default), and has `refetchOnWindowFocus: false`
 * globally — so the tile could show pre-submit state for five minutes with
 * no escape hatch short of a remount.
 *
 * Separately, the pair-trade submit handler omitted `decision-requests`
 * altogether, so a pair recommendation never refreshed the Decision Inbox.
 *
 * ── What this does not claim to fix ──────────────────────────────────────
 *
 * Most of the delay is latency, not staleness: `submitRecommendation` makes
 * eleven strictly sequential awaited round trips before `onSuccess` fires.
 * These tests are about correctness of the invalidation set only.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SUBMIT_INVALIDATION_KEYS, invalidateAfterSubmit } from '../submit-invalidations'

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const read = (p: string) => codeOf(readFileSync(resolve(SRC, p), 'utf8'))

describe('the submit invalidation set', () => {
  it('re-reads the Ideas tile', () => {
    // The whole point. `trade-queue-items` carries the embedded
    // decision_requests that makes a tile show "recommendation submitted".
    expect(SUBMIT_INVALIDATION_KEYS).toContain('trade-queue-items')
  })

  it('re-reads the Decision Inbox', () => {
    expect(SUBMIT_INVALIDATION_KEYS).toContain('decision-requests')
  })

  it('re-reads every surface that reads the proposal rows', () => {
    for (const k of ['trade-lab-proposals', 'trade-proposals', 'deciding-proposals', 'proposals-for-idea', 'proposal']) {
      expect(SUBMIT_INVALIDATION_KEYS).toContain(k)
    }
  })

  it('contains no key that matches nothing', () => {
    // `trade-ideas` and `trade-queue` were invalidated for months and
    // matched no query. A key that cannot fire is worse than a missing
    // one: it looks like coverage.
    expect(SUBMIT_INVALIDATION_KEYS).not.toContain('trade-ideas')
    expect(SUBMIT_INVALIDATION_KEYS).not.toContain('trade-queue')
  })

  it('invalidates each key exactly once, by prefix', () => {
    const calls: unknown[][] = []
    invalidateAfterSubmit({ invalidateQueries: (f) => calls.push(f.queryKey as unknown[]) })
    expect(calls).toHaveLength(SUBMIT_INVALIDATION_KEYS.length)
    // Prefix form only — React Query matches non-exactly, so the helper
    // need not know the variants each surface composes.
    for (const k of calls) expect(k).toHaveLength(1)
    expect(new Set(calls.map(k => k[0])).size).toBe(calls.length)
  })

  it('does not invalidate the whole cache', () => {
    const calls: unknown[][] = []
    invalidateAfterSubmit({ invalidateQueries: (f) => calls.push(f.queryKey as unknown[]) })
    // A bare invalidateQueries() with no key would refetch everything.
    expect(calls.every(k => k.length > 0 && typeof k[0] === 'string')).toBe(true)
  })

  it('does not reach for anything submit does not write', () => {
    // Submit creates no accepted trade and moves no holdings.
    expect(SUBMIT_INVALIDATION_KEYS).not.toContain('accepted-trades')
    expect(SUBMIT_INVALIDATION_KEYS).not.toContain('portfolio-holdings')
  })
})

describe('every submit call site uses the shared list', () => {
  it('the recommendation editor does', () => {
    const modal = read('components/trading/RecommendationEditorModal.tsx')
    expect(modal).toContain('invalidateAfterSubmit(queryClient)')
    // And no longer hand-rolls the dead keys.
    expect(modal).not.toMatch(/queryKey: \['trade-ideas'\]/)
    expect(modal).not.toMatch(/queryKey: \['trade-queue'\]/)
  })

  it('the pair-trade submit does, and no longer omits the Inbox', () => {
    const page = read('pages/TradeQueuePage.tsx')
    expect(page).toContain('invalidateAfterSubmit(queryClient)')
  })

  it('the execute path keeps its own list, which is a different set', () => {
    // Not a copy: execute writes accepted_trades and holdings, submit does
    // not. Sharing one list between them would over-invalidate both.
    const exec = read('lib/services/execute-invalidations.ts')
    expect(exec).toContain('accepted-trades')
    expect(SUBMIT_INVALIDATION_KEYS).not.toContain('accepted-trades')
  })
})
