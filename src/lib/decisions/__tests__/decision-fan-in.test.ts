/**
 * When one portfolio's decision concludes the whole idea — and when it does not.
 *
 * ── Two defects this covers ──────────────────────────────────────────────
 *
 * 1. ACCEPT advanced the idea inside `try { } catch { console.error }`. A
 *    real production approval (SHOP, 2026-10-04 16:08) left
 *    `trade_queue_items.updated_at` at 16:07:56 — the row was never written
 *    — and the database carries no record of why. Three different failures
 *    land in exactly that state: an idempotency short-circuit returns
 *    silently, a throw is swallowed to a console nobody had open, and an
 *    RLS-filtered UPDATE reports no error at all. So the fan-in now reads
 *    the row back and reports, rather than assuming the write landed.
 *
 * 2. REJECT never advanced the idea at all. Iterative reject is a real
 *    behaviour — while any portfolio still owes a decision the analyst can
 *    revise and resubmit — but once EVERY track is rejected there is
 *    nothing to revise for, and the idea sat in the pipeline presenting
 *    itself as still awaiting a decision that had already been made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({
  tracks: [] as Array<{ portfolio_id: string; decision_outcome: string | null }>,
  ideaOutcome: null as string | null,
  tracksError: null as { message: string } | null,
  /** False reproduces a write that resolves without landing. */
  moveWrites: true,
  moveThrows: null as string | null,
}))
const moves = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))

vi.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'eq', 'maybeSingle', 'limit', 'order']) {
        chain[op] = () => chain
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'trade_idea_portfolios') {
          return Promise.resolve({ data: store.tracks, error: store.tracksError }).then(resolve)
        }
        if (table === 'trade_queue_items') {
          return Promise.resolve({ data: { outcome: store.ideaOutcome }, error: null }).then(resolve)
        }
        return Promise.resolve({ data: null, error: null }).then(resolve)
      }
      return chain
    },
  },
}))

vi.mock('../../services/trade-idea-service', () => ({
  moveTradeIdea: vi.fn(async (args: Record<string, unknown>) => {
    moves.calls.push(args)
    if (store.moveThrows) throw new Error(store.moveThrows)
    if (store.moveWrites) store.ideaOutcome = (args.target as { outcome?: string })?.outcome ?? null
  }),
}))

import { resolveIdeaAfterDecision } from '../decision-fan-in'

const CONTEXT = { actorId: 'u1', actorName: 'PM' } as never
const run = (outcome: 'executed' | 'rejected') =>
  resolveIdeaAfterDecision({ tradeQueueItemId: 'tqi-1', outcome, context: CONTEXT, note: 'n' })

beforeEach(() => {
  store.tracks = []; store.ideaOutcome = null; store.tracksError = null
  store.moveWrites = true; store.moveThrows = null
  moves.calls = []
})

describe('the fan-in rule', () => {
  it('concludes an idea with no portfolio tracks at all', async () => {
    // Absence is not an open track: nobody fanned this idea out, so the one
    // decision just made is the whole story. The production SHOP idea had
    // exactly zero rows here.
    expect(await run('executed')).toEqual({ status: 'concluded', outcome: 'executed' })
  })

  it('concludes when every track is resolved', async () => {
    store.tracks = [
      { portfolio_id: 'p1', decision_outcome: 'accepted' },
      { portfolio_id: 'p2', decision_outcome: 'rejected' },
    ]
    expect((await run('executed')).status).toBe('concluded')
  })

  it('leaves the idea live while any track is open', async () => {
    store.tracks = [
      { portfolio_id: 'p1', decision_outcome: 'accepted' },
      { portfolio_id: 'p2', decision_outcome: null },
    ]
    const r = await run('executed')
    expect(r.status).toBe('still_open')
    if (r.status !== 'still_open') return
    expect(r.openPortfolioIds).toEqual(['p2'])
    // Critically: no write at all, so the other PM's card stays put.
    expect(moves.calls).toHaveLength(0)
    expect(store.ideaOutcome).toBeNull()
  })
})

describe('reject is symmetric with accept', () => {
  it('concludes a fully-rejected idea as rejected', async () => {
    store.tracks = [{ portfolio_id: 'p1', decision_outcome: 'rejected' }]
    expect(await run('rejected')).toEqual({ status: 'concluded', outcome: 'rejected' })
    expect(store.ideaOutcome).toBe('rejected')
  })

  it('keeps an iteratively-rejected idea live for the analyst to revise', async () => {
    store.tracks = [
      { portfolio_id: 'p1', decision_outcome: 'rejected' },
      { portfolio_id: 'p2', decision_outcome: null },
    ]
    expect((await run('rejected')).status).toBe('still_open')
  })
})

describe('maturity is never rewritten by a decision', () => {
  it('records the outcome without moving the stage', async () => {
    await run('executed')
    const target = moves.calls[0].target as Record<string, unknown>
    // `stage` measures how far the RESEARCH got. ready_to_recommend is
    // deliberately its last value; concluding a decision is the liveness
    // axis, which is `outcome`.
    expect(target.stage).toBe('ready_to_recommend')
    expect(target.outcome).toBe('executed')
  })
})

describe('failure is reported, never swallowed', () => {
  it('detects a write that resolved but did not land', async () => {
    // The production shape exactly: no error, no exception, no change.
    store.moveWrites = false
    const r = await run('executed')
    expect(r.status).toBe('failed')
    if (r.status !== 'failed') return
    expect(r.reason).toMatch(/not concluded/i)
    expect(r.reason).toMatch(/permissions|request id/i)
  })

  it('reports a thrown validation failure instead of logging it', async () => {
    store.moveThrows = 'Trade has already been decided. Cannot change decision.'
    const r = await run('executed')
    expect(r.status).toBe('failed')
    if (r.status !== 'failed') return
    expect(r.reason).toMatch(/already been decided/)
  })

  it('reports an unreadable track list rather than concluding anyway', async () => {
    store.tracksError = { message: 'permission denied' }
    const r = await run('executed')
    expect(r.status).toBe('failed')
    // Failing closed matters: treating an unreadable list as "no open
    // tracks" would conclude an idea other PMs still owe a decision on.
    expect(moves.calls).toHaveLength(0)
  })

  it('reports a decision with no idea behind it', async () => {
    const r = await resolveIdeaAfterDecision({
      tradeQueueItemId: null, outcome: 'executed', context: CONTEXT, note: 'n',
    })
    expect(r.status).toBe('failed')
  })
})
