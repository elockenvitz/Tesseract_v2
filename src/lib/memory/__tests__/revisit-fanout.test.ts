/**
 * The request budget for parked-work cards.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * This codebase has already paid for this lesson once. A tile that fetched
 * its own data turned a 24-symbol screen into ~6,800 rows across 24
 * independent requests arriving in 24 separate waves, and the fix —
 * batching at the page level — is the reason `TileClosesBatch` exists.
 *
 * "What changed while you were away" is exactly the shape that invites the
 * same mistake: every card wants a price history, a research count and a
 * target comparison, and the obvious place to get them is inside the card.
 *
 * So the budget is asserted rather than hoped for. These tests fail if
 * anyone moves a query into a per-candidate path, which is the only way the
 * pathology comes back.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const db = vi.hoisted(() => ({
  calls: [] as string[],
  closes: [] as any[],
  ideas: [] as any[],
}))

vi.mock('../../supabase', () => {
  const build = (table: string, rows: () => any[]) => {
    db.calls.push(table)
    const api: any = {
      select: () => api, eq: () => api, in: () => api,
      gte: () => api, lte: () => api, order: () => api, limit: () => api,
      then: (resolve: any) => resolve({ data: rows(), error: null }),
    }
    return api
  }
  return {
    supabase: {
      from: (t: string) => {
        if (t === 'price_history_cache') return build(t, () => db.closes)
        if (t === 'trade_queue_items') return build(t, () => db.ideas)
        return build(t, () => [])
      },
    },
  }
})

import { fetchChangeFacts, type ChangeSubject } from '../what-changed'

const NOW = new Date('2026-10-01T12:00:00Z')
const PARKED = '2026-09-20T00:00:00Z'

const subjects = (n: number): ChangeSubject[] =>
  Array.from({ length: n }, (_, i) => ({
    tradeQueueItemId: `idea-${i}`,
    assetId: `asset-${i}`,
    symbol: `SYM${i}`,
    parkedAt: PARKED,
  }))

beforeEach(() => {
  db.calls = []
  db.closes = []
  db.ideas = []
})

async function queryCountFor(n: number): Promise<number> {
  db.calls = []
  db.ideas = subjects(n).map(s => ({ id: s.tradeQueueItemId, updated_at: PARKED, target_price: null }))
  await fetchChangeFacts(subjects(n), NOW)
  return db.calls.length
}

describe('the fan-out does not grow with the number of parked cards', () => {
  it('1 card and 24 cards cost the same number of requests', async () => {
    const one = await queryCountFor(1)
    const many = await queryCountFor(24)
    expect(many).toBe(one)
  })

  it('and the number is small and fixed', async () => {
    // Six: two bounded price windows, object_links, trade_queue_items,
    // accepted_trades, decision_requests. If this rises, something started
    // querying per subject.
    expect(await queryCountFor(12)).toBe(6)
    expect(await queryCountFor(24)).toBe(6)
    expect(await queryCountFor(60)).toBe(6)
  })

  it('duplicate symbols do not multiply the price query', async () => {
    db.ideas = Array.from({ length: 24 }, (_, i) => ({ id: `idea-${i}`, updated_at: PARKED, target_price: null }))
    db.calls = []
    const dupes: ChangeSubject[] = Array.from({ length: 24 }, (_, i) => ({
      tradeQueueItemId: `idea-${i}`, assetId: 'asset-1', symbol: 'NVDA', parkedAt: PARKED,
    }))
    await fetchChangeFacts(dupes, NOW)
    expect(db.calls.filter(c => c === 'price_history_cache')).toHaveLength(2)
  })

  it('an empty batch issues nothing at all', async () => {
    expect(await queryCountFor(0)).toBe(0)
  })

  it('missing price history costs no extra request', async () => {
    db.closes = []
    expect(await queryCountFor(24)).toBe(6)
  })
})

describe('the price query stays inside the row cap', () => {
  it('uses two bounded windows rather than one open range', async () => {
    // Fetching every close between the oldest park and today is the
    // tempting shape and the wrong one: 24 symbols over a year is ~8,700
    // rows against PostgREST's 1,000-row cap, and the truncation is silent
    // — a short series that still looks like data.
    await queryCountFor(24)
    expect(db.calls.filter(c => c === 'price_history_cache')).toHaveLength(2)
  })

  it('an ancient park does not widen the query count', async () => {
    db.ideas = [{ id: 'idea-0', updated_at: PARKED, target_price: null }]
    db.calls = []
    await fetchChangeFacts(
      [{ tradeQueueItemId: 'idea-0', assetId: 'a', symbol: 'NVDA', parkedAt: '2019-01-01T00:00:00Z' }],
      NOW,
    )
    expect(db.calls.filter(c => c === 'price_history_cache')).toHaveLength(2)
  })
})

describe('one pass, not one per card', () => {
  it('every subject is resolved in the same call', async () => {
    db.ideas = subjects(24).map(s => ({ id: s.tradeQueueItemId, updated_at: PARKED, target_price: null }))
    db.calls = []
    const map = await fetchChangeFacts(subjects(24), NOW)
    // 24 answers, 6 requests. The ratio is the whole point.
    expect(map.size).toBe(24)
    expect(db.calls.length).toBe(6)
  })

  it('no table is queried more than twice', async () => {
    await queryCountFor(24)
    const counts = new Map<string, number>()
    for (const c of db.calls) counts.set(c, (counts.get(c) ?? 0) + 1)
    for (const [, n] of counts) expect(n).toBeLessThanOrEqual(2)
  })
})
