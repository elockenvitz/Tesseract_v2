/**
 * The writer's guarantees.
 *
 *   one submission      -> exactly one version
 *   a retry             -> still exactly one version
 *   a real revision     -> a second version, the first untouched
 *   a failed submission -> no half-written version
 *
 * Tested against a fake that models the DB's real constraints — both unique
 * indexes — because a mock that accepts every insert would certify an
 * idempotency scheme that does not work.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const db = vi.hoisted(() => ({
  idea: null as Record<string, unknown> | null,
  ideaError: null as { message: string } | null,
  theses: [] as Array<Record<string, unknown>>,
  versions: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string } | null,
}))

vi.mock('../../supabase', () => {
  /** Models `unique (proposal_id, version_number)` and the partial
   *  `unique (proposal_id, dedupe_key) where dedupe_key is not null`. */
  const insertVersion = (row: Record<string, unknown>) => {
    if (db.insertError) return { data: null, error: db.insertError }
    const clash = db.versions.find(
      v =>
        v.proposal_id === row.proposal_id &&
        (v.version_number === row.version_number ||
          (row.dedupe_key != null && v.dedupe_key === row.dedupe_key)),
    )
    if (clash) {
      return { data: null, error: { message: 'duplicate key value violates unique constraint' } }
    }
    const saved = { id: `ver-${db.versions.length + 1}`, ...row }
    db.versions.push(saved)
    return { data: saved, error: null }
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'trade_queue_items') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: db.idea, error: db.ideaError }) }),
            }),
          }
        }
        if (table === 'trade_idea_theses') {
          return {
            select: () => ({
              eq: () => ({ order: async () => ({ data: db.theses, error: null }) }),
            }),
          }
        }
        if (table === 'trade_proposal_versions') {
          return {
            select: () => ({
              eq: (_c1: string, v1: unknown) => ({
                // nextVersionNumber(): .eq().order().limit().maybeSingle()
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      const mine = db.versions.filter(v => v.proposal_id === v1)
                      const top = mine.sort(
                        (a, b) => (b.version_number as number) - (a.version_number as number),
                      )[0]
                      return { data: top ?? null, error: null }
                    },
                  }),
                }),
                // findVersionByFingerprint(): .eq().eq().maybeSingle()
                eq: (_c2: string, v2: unknown) => ({
                  maybeSingle: async () => ({
                    data:
                      db.versions.find(v => v.proposal_id === v1 && v.dedupe_key === v2) ?? null,
                    error: null,
                  }),
                }),
                maybeSingle: async () => ({
                  data: db.versions.find(v => v.id === v1) ?? null,
                  error: null,
                }),
              }),
            }),
            insert: (row: Record<string, unknown>) => ({
              select: () => ({ single: async () => insertVersion(row) }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    },
  }
})

import { captureRecommendationVersion } from '../recommendation-version'

const INPUT = {
  proposalId: 'prop-1',
  tradeQueueItemId: 'tqi-1',
  portfolioId: 'pf-1',
  organizationId: 'org-1',
  actorId: 'analyst-1',
  weight: 1.0,
  shares: null,
  sizingMode: 'weight',
  sizingContext: {},
  notes: 'Sizing to 100bps.',
  action: 'add',
}

beforeEach(() => {
  db.idea = {
    asset_id: 'asset-1',
    stage: 'ready_to_recommend',
    thesis_text: 'Thesis A',
    rationale: 'Rationale A',
    conviction: 'high',
    target_price: 240,
    stop_loss: null,
    take_profit: null,
    time_horizon: 'medium',
  }
  db.ideaError = null
  db.theses = [
    { id: 'th-1', direction: 'bull', rationale: 'Bull A', conviction: 'high', created_at: '2026-01-02T00:00:00Z' },
  ]
  db.versions = []
  db.insertError = null
})

describe('a submission creates exactly one immutable version', () => {
  it('writes one row carrying the sizing and the reasoning', async () => {
    const v = await captureRecommendationVersion(INPUT)
    expect(db.versions).toHaveLength(1)
    expect(v.version_number).toBe(1)
    expect(v.weight).toBe(1.0)
    expect(v.action).toBe('add')
    expect(v.thesis_text).toBe('Thesis A')
    expect(v.conviction).toBe('high')
    expect(v.target_price).toBe(240)
    expect(v.theses).toHaveLength(1)
    expect(v.trigger_event).toBe('submission')
  })

  it('records provenance for every captured field', async () => {
    const v = await captureRecommendationVersion(INPUT)
    const fields = (v.captured_from as any).fields
    expect(fields.thesis_text).toEqual({ table: 'trade_queue_items', id: 'tqi-1', field: 'thesis_text' })
    expect(fields.idea_stage).toEqual({ table: 'trade_queue_items', id: 'tqi-1', field: 'stage' })
    expect(fields.theses).toMatchObject({ table: 'trade_idea_theses', ids: ['th-1'] })
    expect((v.captured_from as any).captured_at).toBeTruthy()
  })

  it('captures tenancy and authorship, which RLS requires', async () => {
    const v = await captureRecommendationVersion(INPUT)
    expect(v.organization_id).toBe('org-1')
    expect(v.portfolio_id).toBe('pf-1')
    expect(v.created_by).toBe('analyst-1')
  })

  it('does not capture current market or portfolio facts', async () => {
    const v = await captureRecommendationVersion(INPUT)
    // A frozen copy of a current fact is a stale fact that looks
    // authoritative. Only reasoning and the submitted sizing are frozen.
    for (const forbidden of ['current_price', 'market_price', 'current_weight', 'performance']) {
      expect(Object.keys(v)).not.toContain(forbidden)
    }
  })
})

describe('a retry does not duplicate the version', () => {
  it('three identical attempts produce one row and the same id', async () => {
    const a = await captureRecommendationVersion(INPUT)
    const b = await captureRecommendationVersion(INPUT)
    const c = await captureRecommendationVersion(INPUT)
    expect(db.versions).toHaveLength(1)
    expect(b.id).toBe(a.id)
    expect(c.id).toBe(a.id)
  })

  it('a retry an hour later still lands on the same version', async () => {
    // Time has to MOVE for this to mean anything. Without the clock
    // advancing, a fingerprint that wrongly included a timestamp would still
    // match on a fast machine and this suite would pass a broken scheme —
    // which is exactly what happened when the timestamp was injected
    // deliberately to check these tests could fail.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-10T09:00:00Z'))
      const first = await captureRecommendationVersion(INPUT)
      vi.setSystemTime(new Date('2026-01-10T10:00:00Z'))
      const retry = await captureRecommendationVersion(INPUT)
      expect(retry.id).toBe(first.id)
      expect(db.versions).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a retry whose pre-check misses still lands once', async () => {
    // The concurrency case: two submissions race past the fingerprint read
    // and both try to insert. The unique index rejects the second, and the
    // writer recovers by re-reading rather than by erroring or by minting a
    // second version under the next version_number.
    const first = await captureRecommendationVersion(INPUT)
    const seeded = db.versions[0]
    const spy = vi.spyOn(db.versions, 'find')
    let call = 0
    spy.mockImplementation(function (this: unknown, pred: any) {
      // Make only the FIRST lookup (the pre-check) miss.
      if (call++ === 0) return undefined
      return Array.prototype.find.call(db.versions, pred)
    } as never)
    const second = await captureRecommendationVersion(INPUT)
    spy.mockRestore()
    expect(second.id).toBe(first.id)
    expect(db.versions).toHaveLength(1)
    expect(db.versions[0]).toBe(seeded)
  })
})

describe('a real revision creates a second version and preserves the first', () => {
  it('resubmitting at a different size versions up', async () => {
    const v1 = await captureRecommendationVersion(INPUT)
    const v2 = await captureRecommendationVersion({ ...INPUT, weight: 2.0 })
    expect(db.versions).toHaveLength(2)
    expect(v1.version_number).toBe(1)
    expect(v2.version_number).toBe(2)
    expect(v2.id).not.toBe(v1.id)
  })

  it('an edited thesis versions up even at identical sizing', async () => {
    const v1 = await captureRecommendationVersion(INPUT)
    db.idea!.thesis_text = 'Thesis B'
    const v2 = await captureRecommendationVersion(INPUT)
    expect(v2.id).not.toBe(v1.id)
    expect(v2.thesis_text).toBe('Thesis B')
  })

  it('version 1 still says Thesis A after version 2 says Thesis B', async () => {
    await captureRecommendationVersion(INPUT)
    db.idea!.thesis_text = 'Thesis B'
    db.idea!.conviction = 'low'
    await captureRecommendationVersion(INPUT)
    // The whole point: the first row is untouched on disk.
    expect(db.versions[0].thesis_text).toBe('Thesis A')
    expect(db.versions[0].conviction).toBe('high')
    expect(db.versions[1].thesis_text).toBe('Thesis B')
  })
})

describe('a failed submission leaves no orphan snapshot', () => {
  it('throws rather than returning a partial version', async () => {
    db.insertError = { message: 'permission denied for table trade_proposal_versions' }
    await expect(captureRecommendationVersion(INPUT)).rejects.toThrow(/Failed to freeze/)
    expect(db.versions).toHaveLength(0)
  })

  it('a missing idea does not silently freeze an empty recommendation', async () => {
    db.ideaError = { message: 'permission denied' }
    await expect(captureRecommendationVersion(INPUT)).rejects.toThrow(/Failed to read idea state/)
    expect(db.versions).toHaveLength(0)
  })

  it('throwing is the point: the submission must fail, not half-succeed', async () => {
    // Unlike the Memory Spine writers, which swallow failures because the
    // canonical action already happened, this IS part of the submission. A
    // submission that cannot record what it recommended must not proceed to
    // create a decision request.
    db.insertError = { message: 'network' }
    let created = false
    try {
      await captureRecommendationVersion(INPUT)
      created = true
    } catch {
      /* expected */
    }
    expect(created).toBe(false)
  })

  it('unavailable theses degrade to an empty list, not to a failed submission', async () => {
    // Bull/bear cases are supporting detail. Losing them must not block a
    // recommendation reaching a PM — but the provenance still records that
    // the table was consulted.
    db.theses = []
    const v = await captureRecommendationVersion(INPUT)
    expect(v.theses).toEqual([])
    expect((v.captured_from as any).fields.theses.ids).toEqual([])
  })
})
