/**
 * The deterministic fact engine.
 *
 * Two things are under test, and the second matters more:
 *
 *   1. The facts it produces are correct.
 *   2. The facts it REFUSES to produce stay refused — no interpolated
 *      price, no invented before-value, no weight derived through an
 *      aggregation this codebase has a documented defect class for.
 *
 * Query count is asserted too. Twenty-four subjects must cost the same
 * number of round trips as one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const db = vi.hoisted(() => ({
  closes: [] as any[],
  links: [] as any[],
  ideas: [] as any[],
  trades: [] as any[],
  decisions: [] as any[],
  queries: [] as string[],
}))

vi.mock('../../supabase', () => {
  const build = (table: string, rows: () => any[]) => {
    db.queries.push(table)
    const filters: Array<(r: any) => boolean> = []
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => (filters.push(r => r[c] === v), api),
      in: (c: string, v: unknown[]) => (filters.push(r => v.includes(r[c])), api),
      gte: (c: string, v: string) => (filters.push(r => String(r[c]) >= v), api),
      lte: (c: string, v: string) => (filters.push(r => String(r[c]) <= v), api),
      order: () => api,
      limit: () => api,
      then: (resolve: any) =>
        resolve({ data: rows().filter(r => filters.every(f => f(r))), error: null }),
    }
    return api
  }
  return {
    supabase: {
      from: (t: string) => {
        if (t === 'price_history_cache') return build(t, () => db.closes)
        if (t === 'object_links') return build(t, () => db.links)
        if (t === 'trade_queue_items') return build(t, () => db.ideas)
        if (t === 'accepted_trades') return build(t, () => db.trades)
        if (t === 'decision_requests') return build(t, () => db.decisions)
        throw new Error(`unexpected table ${t}`)
      },
    },
  }
})

import { fetchChangeFacts, renderableFacts, type ChangeSubject } from '../what-changed'

const NOW = new Date('2026-10-01T12:00:00Z')
const PARKED = '2026-09-20T00:00:00Z'

const SUBJECT: ChangeSubject = {
  tradeQueueItemId: 'idea-1', assetId: 'asset-1', symbol: 'NVDA', parkedAt: PARKED,
}

const factsFor = async (subjects = [SUBJECT]) =>
  (await fetchChangeFacts(subjects, NOW)).get(subjects[0].tradeQueueItemId)!

const kinds = (fs: Awaited<ReturnType<typeof factsFor>>) => fs.map(f => f.kind)

beforeEach(() => {
  db.closes = []
  db.links = []
  db.ideas = [{ id: 'idea-1', updated_at: PARKED, target_price: null }]
  db.trades = []
  db.decisions = []
  db.queries = []
})

describe('price change', () => {
  beforeEach(() => {
    db.closes = [
      { symbol: 'NVDA', date: '2026-09-19', close: 100 },
      { symbol: 'NVDA', date: '2026-09-30', close: 108.4 },
    ]
  })

  it('compares the close at or before the park with the latest', async () => {
    const [f] = await factsFor()
    expect(f.kind).toBe('price_change')
    expect(f.label).toBe('+8.4% price')
  })

  it('carries both as-of dates, because a stale cache makes it a lie', async () => {
    const [f] = await factsFor()
    expect(f.confidence).toBe('SAFE_WITH_ATTRIBUTION')
    expect(f.attribution).toBe('close 2026-09-19 → 2026-09-30')
    expect(f.from).toBe('2026-09-19')
    expect(f.to).toBe('2026-09-30')
  })

  it('never uses a close from AFTER the park as the baseline', async () => {
    db.closes = [
      { symbol: 'NVDA', date: '2026-09-19', close: 100 },
      { symbol: 'NVDA', date: '2026-09-25', close: 50 }, // mid-window
      { symbol: 'NVDA', date: '2026-09-30', close: 110 },
    ]
    const [f] = await factsFor()
    // Baselining on the 25th would report +120% instead of +10%.
    expect(f.label).toBe('+10.0% price')
  })

  it('reports a fall as a fall', async () => {
    db.closes = [
      { symbol: 'NVDA', date: '2026-09-19', close: 100 },
      { symbol: 'NVDA', date: '2026-09-30', close: 91.2 },
    ]
    expect((await factsFor())[0].label).toBe('-8.8% price')
  })

  it('omits the fact entirely when no close precedes the park', async () => {
    // Interpolating, or silently using the first close after the park,
    // would present an estimate as an exact comparison.
    db.closes = [{ symbol: 'NVDA', date: '2026-09-30', close: 108 }]
    expect(kinds(await factsFor())).not.toContain('price_change')
  })

  it('omits the fact when the symbol has no history at all', async () => {
    db.closes = []
    expect(kinds(await factsFor())).not.toContain('price_change')
  })

  it('omits a subject with no symbol rather than guessing one', async () => {
    const f = await factsFor([{ ...SUBJECT, symbol: null }])
    expect(kinds(f)).not.toContain('price_change')
  })

  it('suppresses sub-0.05% noise dressed as a finding', async () => {
    db.closes = [
      { symbol: 'NVDA', date: '2026-09-19', close: 100 },
      { symbol: 'NVDA', date: '2026-09-30', close: 100.02 },
    ]
    expect(kinds(await factsFor())).not.toContain('price_change')
  })
})

describe('research added', () => {
  it('counts links created since the park', async () => {
    db.links = [
      { id: 'l1', target_id: 'idea-1', target_type: 'trade_idea', created_at: '2026-09-25T00:00:00Z' },
      { id: 'l2', target_id: 'idea-1', target_type: 'trade_idea', created_at: '2026-09-28T00:00:00Z' },
      { id: 'l3', target_id: 'idea-1', target_type: 'trade_idea', created_at: '2026-09-29T00:00:00Z' },
    ]
    const [f] = await factsFor()
    expect(f.label).toBe('3 new research items')
    expect(f.confidence).toBe('SAFE_FACT')
    expect(f.sourceIds).toEqual(['l1', 'l2', 'l3'])
  })

  it('singularises one', async () => {
    db.links = [{ id: 'l1', target_id: 'idea-1', target_type: 'trade_idea', created_at: '2026-09-25T00:00:00Z' }]
    expect((await factsFor())[0].label).toBe('1 new research item')
  })

  it('excludes links that predate the park', async () => {
    db.links = [{ id: 'old', target_id: 'idea-1', target_type: 'trade_idea', created_at: '2026-09-01T00:00:00Z' }]
    expect(kinds(await factsFor())).not.toContain('research_added')
  })
})

describe('idea edited', () => {
  it('says only THAT it was edited', async () => {
    db.ideas = [{ id: 'idea-1', updated_at: '2026-09-28T00:00:00Z', target_price: null }]
    const [f] = await factsFor()
    expect(f.kind).toBe('idea_edited')
    expect(f.label).toBe('The idea was edited')
    // `audit_events` had from_state hardcoded for idea edits, so any
    // "changed from X" built on it would be fiction.
    expect(f.label).not.toMatch(/from/i)
  })

  it('is absent when nothing changed since the park', async () => {
    db.ideas = [{ id: 'idea-1', updated_at: PARKED, target_price: null }]
    expect(kinds(await factsFor())).not.toContain('idea_edited')
  })
})

describe('target price change', () => {
  it('reports before and after when a frozen version predates the park', async () => {
    db.ideas = [{ id: 'idea-1', updated_at: '2026-09-28T00:00:00Z', target_price: 135 }]
    db.decisions = [{
      id: 'dr-1', trade_queue_item_id: 'idea-1', status: 'pending', reviewed_at: null,
      proposal_version_id: 'v1',
      proposal_version: { id: 'v1', target_price: 120, submitted_at: '2026-09-10T00:00:00Z' },
    }]
    const f = (await factsFor()).find(x => x.kind === 'target_price_changed')!
    expect(f.label).toBe('Target changed from $120 to $135')
    expect(f.confidence).toBe('SAFE_FACT')
  })

  it('is OMITTED when no frozen version supplies a before-value', async () => {
    // This is the important one. "Target changed to $135" with an invented
    // or current-state "from" is exactly the class of claim this engine
    // exists to not make.
    db.ideas = [{ id: 'idea-1', updated_at: '2026-09-28T00:00:00Z', target_price: 135 }]
    db.decisions = []
    expect(kinds(await factsFor())).not.toContain('target_price_changed')
  })

  it('is omitted when the version was submitted AFTER the park', async () => {
    // Then it is not a "before" at all.
    db.ideas = [{ id: 'idea-1', updated_at: '2026-09-28T00:00:00Z', target_price: 135 }]
    db.decisions = [{
      id: 'dr-1', trade_queue_item_id: 'idea-1', status: 'pending', reviewed_at: null,
      proposal_version_id: 'v1',
      proposal_version: { id: 'v1', target_price: 120, submitted_at: '2026-09-25T00:00:00Z' },
    }]
    expect(kinds(await factsFor())).not.toContain('target_price_changed')
  })

  it('is omitted when the value did not actually move', async () => {
    db.ideas = [{ id: 'idea-1', updated_at: '2026-09-28T00:00:00Z', target_price: 120 }]
    db.decisions = [{
      id: 'dr-1', trade_queue_item_id: 'idea-1', status: 'pending', reviewed_at: null,
      proposal_version_id: 'v1',
      proposal_version: { id: 'v1', target_price: 120, submitted_at: '2026-09-10T00:00:00Z' },
    }]
    expect(kinds(await factsFor())).not.toContain('target_price_changed')
  })
})

describe('trades and decisions', () => {
  it('counts trades committed since the park', async () => {
    db.trades = [
      { id: 't1', trade_queue_item_id: 'idea-1', created_at: '2026-09-25T00:00:00Z', action: 'buy', is_active: true },
    ]
    const f = (await factsFor()).find(x => x.kind === 'trade_committed')!
    expect(f.label).toBe('1 trade committed')
    expect(f.sourceType).toBe('accepted_trades')
  })

  it('counts only RESOLVED decisions since the park', async () => {
    db.decisions = [
      { id: 'd1', trade_queue_item_id: 'idea-1', status: 'accepted', reviewed_at: '2026-09-25T00:00:00Z', proposal_version_id: null, proposal_version: null },
      { id: 'd2', trade_queue_item_id: 'idea-1', status: 'pending', reviewed_at: null, proposal_version_id: null, proposal_version: null },
      { id: 'd3', trade_queue_item_id: 'idea-1', status: 'rejected', reviewed_at: '2026-09-01T00:00:00Z', proposal_version_id: null, proposal_version: null },
    ]
    const f = (await factsFor()).find(x => x.kind === 'decision_recorded')!
    expect(f.label).toBe('1 decision recorded')
    expect(f.sourceIds).toEqual(['d1'])
  })
})

describe('what this engine refuses to produce', () => {
  it('never emits a portfolio weight fact', async () => {
    // `portfolio_holdings` stores shares/price/cost per date, not weight.
    // Deriving one means aggregating every holding at two dates — the
    // documented "portfolio holdings collapse" defect class. Skipped, not
    // approximated.
    db.closes = [
      { symbol: 'NVDA', date: '2026-09-19', close: 100 },
      { symbol: 'NVDA', date: '2026-09-30', close: 110 },
    ]
    db.links = [{ id: 'l1', target_id: 'idea-1', target_type: 'trade_idea', created_at: '2026-09-25T00:00:00Z' }]
    const all = await factsFor()
    expect(all.map(f => f.label).join(' ')).not.toMatch(/weight/i)
    expect(all.map(f => f.sourceType)).not.toContain('portfolio_holdings')
  })

  it('never emits an earnings or news fact', async () => {
    const all = await factsFor()
    expect(all.map(f => f.label).join(' ')).not.toMatch(/earnings|news/i)
  })

  it('never surfaces an UNRELIABLE or AI_SUMMARY fact automatically', async () => {
    db.closes = [
      { symbol: 'NVDA', date: '2026-09-19', close: 100 },
      { symbol: 'NVDA', date: '2026-09-30', close: 110 },
    ]
    const renderable = renderableFacts(await factsFor())
    for (const f of renderable) {
      expect(['SAFE_FACT', 'SAFE_WITH_ATTRIBUTION']).toContain(f.confidence)
    }
  })

  it('returns an empty list rather than filler when nothing changed', async () => {
    expect(await factsFor()).toEqual([])
  })
})

describe('ordering and batching', () => {
  it('puts the most consequential fact first', async () => {
    db.closes = [
      { symbol: 'NVDA', date: '2026-09-19', close: 100 },
      { symbol: 'NVDA', date: '2026-09-30', close: 110 },
    ]
    db.links = [{ id: 'l1', target_id: 'idea-1', target_type: 'trade_idea', created_at: '2026-09-25T00:00:00Z' }]
    db.trades = [{ id: 't1', trade_queue_item_id: 'idea-1', created_at: '2026-09-25T00:00:00Z', action: 'buy', is_active: true }]
    db.ideas = [{ id: 'idea-1', updated_at: '2026-09-28T00:00:00Z', target_price: null }]
    expect(kinds(await factsFor())[0]).toBe('trade_committed')
    expect(kinds(await factsFor()).at(-1)).toBe('idea_edited')
  })

  it('24 subjects cost the same number of queries as 1', async () => {
    const one = [SUBJECT]
    db.queries = []
    await fetchChangeFacts(one, NOW)
    const forOne = db.queries.length

    const many: ChangeSubject[] = Array.from({ length: 24 }, (_, i) => ({
      tradeQueueItemId: `idea-${i}`, assetId: `asset-${i}`, symbol: `SYM${i}`, parkedAt: PARKED,
    }))
    db.ideas = many.map(s => ({ id: s.tradeQueueItemId, updated_at: PARKED, target_price: null }))
    db.queries = []
    await fetchChangeFacts(many, NOW)

    // The TileClosesBatch lesson: 24 tiles must not become 24 requests.
    expect(db.queries.length).toBe(forOne)
    expect(db.queries.length).toBeLessThanOrEqual(6)
  })

  it('returns an entry for every subject, including ones with no facts', async () => {
    const subjects: ChangeSubject[] = [
      SUBJECT,
      { tradeQueueItemId: 'idea-2', assetId: null, symbol: null, parkedAt: PARKED },
    ]
    db.ideas = [
      { id: 'idea-1', updated_at: PARKED, target_price: null },
      { id: 'idea-2', updated_at: PARKED, target_price: null },
    ]
    const map = await fetchChangeFacts(subjects, NOW)
    expect(map.size).toBe(2)
    expect(map.get('idea-2')).toEqual([])
  })

  it('an empty batch issues no queries at all', async () => {
    db.queries = []
    const map = await fetchChangeFacts([], NOW)
    expect(map.size).toBe(0)
    expect(db.queries).toHaveLength(0)
  })

  it('facts never cross between subjects', async () => {
    const subjects: ChangeSubject[] = [
      SUBJECT,
      { tradeQueueItemId: 'idea-2', assetId: 'asset-2', symbol: 'AMD', parkedAt: PARKED },
    ]
    db.ideas = subjects.map(s => ({ id: s.tradeQueueItemId, updated_at: PARKED, target_price: null }))
    db.links = [{ id: 'l1', target_id: 'idea-2', target_type: 'trade_idea', created_at: '2026-09-25T00:00:00Z' }]
    const map = await fetchChangeFacts(subjects, NOW)
    expect(map.get('idea-1')).toEqual([])
    expect(map.get('idea-2')!.map(f => f.kind)).toEqual(['research_added'])
  })
})
