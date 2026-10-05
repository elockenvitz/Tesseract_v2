/**
 * Trade Lab concludes an idea the same way the Decision Inbox does.
 *
 * ── The invariant ────────────────────────────────────────────────────────
 *
 *     stage + outcome are authoritative → status is DERIVED
 *
 * `status` is computed by `stageToLegacyStatus(stage, outcome)`. Any writer
 * that sets it directly is writing to a cache, and a row whose cache says
 * terminal while its outcome says nothing is a row that disagrees with
 * itself — the Outcomes ledger and the active-work predicate read `outcome`,
 * the legacy surfaces read `status`, and they stop agreeing.
 *
 * ── What was bypassing it ────────────────────────────────────────────────
 *
 * Two writers, both scanning `trade_idea_portfolios` themselves and then
 * writing `status` straight onto `trade_queue_items`:
 *
 *   execute-sim-variants  advanceTradeIdeaAfterExecute → status 'executed'
 *   trade-lab-service     portfolio-track sync → 'approved'/'cancelled'/'rejected'
 *
 * `decision-fan-in` was written to absorb exactly these — its own docstring
 * names them — and the Inbox path was converted while these two were not.
 * Production carried the result: AAPL `a1f81ecf`, `status='executed'` with
 * `outcome=NULL`, after a Trade Lab bulk execute on 2026-10-05.
 *
 * These tests run the REAL fan-in over a Supabase double, so a future writer
 * that goes back to a direct UPDATE fails here rather than in production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Op = [string, unknown[]]

const store = vi.hoisted(() => ({
  idea: {} as Record<string, unknown>,
  tracks: [] as Array<{ portfolio_id: string; decision_outcome: string | null }>,
  requests: [] as Array<Record<string, unknown>>,
  trades: [] as Array<Record<string, unknown>>,
  ideaUpdates: [] as Array<Record<string, unknown>>,
  /** `valid_outcome_at_final_stage`, as production now enforces it. */
  constraintOn: true,
}))

const has = (ops: Op[], n: string) => ops.some(([o]) => o === n)
const arg0 = (ops: Op[], n: string) =>
  ops.find(([o]) => o === n)?.[1][0] as Record<string, unknown> | undefined

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      const call = { table, ops: [] as Op[] }
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'is',
                        'not', 'lte', 'gte', 'contains', 'order', 'limit',
                        'maybeSingle', 'single']) {
        chain[op] = (...a: unknown[]) => { call.ops.push([op, a]); return chain }
      }
      chain.then = (resolve_: (v: unknown) => unknown) => {
        let data: unknown = null
        if (table === 'trade_queue_items' && has(call.ops, 'update')) {
          const u = arg0(call.ops, 'update')!
          store.ideaUpdates.push(u)
          const next = { ...store.idea, ...u }
          // The production CHECK: an outcome is only allowed at the canonical
          // final stage or the legacy `deciding`.
          if (store.constraintOn && next.outcome != null
              && next.stage !== 'ready_to_recommend' && next.stage !== 'deciding') {
            return Promise.resolve({
              data: null,
              error: { code: '23514', message: 'violates check constraint "valid_outcome_at_final_stage"' },
            }).then(resolve_)
          }
          Object.assign(store.idea, u)
        } else if (table === 'trade_queue_items') {
          data = { ...store.idea }
        } else if (table === 'trade_idea_portfolios') {
          data = has(call.ops, 'update') ? [] : store.tracks
        } else if (table === 'decision_requests') {
          data = store.requests
        } else if (table === 'accepted_trades') {
          data = store.trades
        } else if (table === 'audit_events') {
          data = []
        } else if (has(call.ops, 'select')) {
          data = []
        }
        return Promise.resolve({ data, error: null }).then(resolve_)
      }
      return chain
    },
  },
}))

vi.mock('../../audit/audit-service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  emitAuditEvent: vi.fn(async () => null),
}))
vi.mock('../../memory/obligations', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  clearIdeaRevisitObligation: vi.fn(async () => {}),
}))

import { resolveIdeaAfterDecision } from '../../decisions/decision-fan-in'
import { emitAuditEvent } from '../../audit/audit-service'

const context = {
  actorId: 'user-pm', actorName: 'PM', actorRole: 'pm',
  requestId: 'bulk-execute-1791223392647',
} as never

/** A canonical-stage idea, mid-flight. */
const canonical = () => ({
  id: 'tqi-1', stage: 'ready_to_recommend', outcome: null, status: 'deciding',
  visibility_tier: 'active', action: 'add', organization_id: 'org-1',
  portfolio_id: 'pf-1', created_by: 'user-pm', assigned_to: null,
})

/** A seeded idea on the LEGACY stage vocabulary, as the pilot seeder plants it. */
const legacySeed = () => ({ ...canonical(), stage: 'ready_for_decision' })

beforeEach(() => {
  store.idea = canonical()
  store.tracks = []
  store.requests = [{ status: 'accepted', created_at: '2026-10-05T18:03:00Z' }]
  store.trades = [{ is_active: true, reverted_at: null }]
  store.ideaUpdates = []
  store.constraintOn = true
  vi.clearAllMocks()
  vi.mocked(emitAuditEvent).mockImplementation(async () => null)
})

describe('single-portfolio Trade Lab execute', () => {
  it('concludes the idea with a canonical terminal outcome', async () => {
    const r = await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-1', outcome: 'executed', context,
      note: 'All portfolios resolved — trade idea concluded after Trade Lab execute',
    })
    expect(r).toEqual({ status: 'concluded', outcome: 'executed' })
    expect(store.idea.outcome).toBe('executed')
  })

  it('derives status rather than manufacturing it', async () => {
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-1', outcome: 'executed', context, note: 'n',
    })
    const write = store.ideaUpdates[0]
    // `status` is present because `moveTradeIdea` DERIVES it — alongside the
    // outcome that justifies it, never on its own.
    expect(write.status).toBe('executed')
    expect(write.outcome).toBe('executed')
    expect(store.idea.status).toBe('executed')
  })

  it('writes exactly once', async () => {
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-1', outcome: 'executed', context, note: 'n',
    })
    expect(store.ideaUpdates).toHaveLength(1)
  })

  it('emits the audit event the old writer never wrote', async () => {
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-1', outcome: 'executed', context, note: 'n',
    })
    expect(emitAuditEvent).toHaveBeenCalled()
  })

  it('preserves stage — terminality is outcome-based', async () => {
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-1', outcome: 'executed', context, note: 'n',
    })
    expect(store.idea.stage).toBe('ready_to_recommend')
  })
})

describe('multi-portfolio fan-in', () => {
  it('holds the idea open while another portfolio still owes a decision', async () => {
    store.tracks = [
      { portfolio_id: 'pf-1', decision_outcome: 'accepted' },
      { portfolio_id: 'pf-2', decision_outcome: null },
    ]
    const r = await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-1', outcome: 'executed', context, note: 'n',
    })
    expect(r).toEqual({ status: 'still_open', openPortfolioIds: ['pf-2'] })
    expect(store.ideaUpdates).toHaveLength(0)
    expect(store.idea.outcome).toBeNull()
  })

  it('concludes once every track is decided', async () => {
    store.tracks = [
      { portfolio_id: 'pf-1', decision_outcome: 'accepted' },
      { portfolio_id: 'pf-2', decision_outcome: 'rejected' },
    ]
    const r = await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-1', outcome: 'executed', context, note: 'n',
    })
    expect(r.status).toBe('concluded')
  })

  it('treats an idea with no tracks as concluded by this decision', async () => {
    // The ad-hoc Trade Lab shape: nobody fanned it out per portfolio.
    store.tracks = []
    const r = await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-1', outcome: 'executed', context, note: 'n',
    })
    expect(r.status).toBe('concluded')
  })
})

describe('a seeded idea on a legacy stage', () => {
  /*
   * The pilot seeder plants ideas at `aware`, `investigate`, `deep_research`,
   * `thesis_forming`, `ready_for_decision` — the 15-value legacy enum. The
   * production constraint permits an outcome only at `ready_to_recommend` or
   * `deciding`, so concluding one of these has to canonicalize the stage.
   *
   * `moveTradeIdea` is already passed `stage: FINAL_STAGE`, so it does. The
   * fix is NOT to weaken the constraint and NOT to write the idea back to a
   * legacy stage — it is that deciding an idea moves it to the canonical
   * final maturity, which is what the Inbox has always done.
   */
  it('canonicalizes the stage so the conclusion is permitted', async () => {
    store.idea = legacySeed()
    const r = await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-1', outcome: 'executed', context, note: 'n',
    })
    expect(r.status).toBe('concluded')
    expect(store.idea.stage).toBe('ready_to_recommend')
    expect(store.idea.outcome).toBe('executed')
  })

  it('does not leave it on the legacy stage with a terminal status', async () => {
    // The exact production shape this convergence removes.
    store.idea = legacySeed()
    await resolveIdeaAfterDecision({
      tradeQueueItemId: 'tqi-1', outcome: 'executed', context, note: 'n',
    })
    const bad = store.idea.status === 'executed' && store.idea.outcome == null
    expect(bad).toBe(false)
  })
})

describe('no Trade Lab writer manufactures a terminal status', () => {
  const code = (p: string) =>
    readFileSync(resolve(__dirname, '../..', p), 'utf8')
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')

  it('execute-sim-variants routes through the shared fan-in', () => {
    const src = code('services/execute-sim-variants-service.ts')
    expect(src).toContain('resolveIdeaAfterDecision')
    expect(src).not.toMatch(/status:\s*'executed'/)
  })

  it('trade-lab-service routes through the shared fan-in', () => {
    const src = code('services/trade-lab-service.ts')
    expect(src).toContain('resolveIdeaAfterDecision')
    // The old derived-status literals, gone.
    expect(src).not.toMatch(/const newStatus = anyAccepted/)
  })

  it('the ad-hoc INSERT is left alone, because it is consistent', () => {
    /*
     * `execute-sim-variants` also INSERTS a new ad-hoc idea with
     * `status: 'deciding'` and `stage: FINAL_STAGE`. That is not a bypass:
     * 'deciding' is exactly what `stageToLegacyStatus('ready_to_recommend',
     * null)` derives, so the cache agrees with its source. Converting it
     * would be churn, and the invariant does not need it.
     */
    const src = code('services/execute-sim-variants-service.ts')
    expect(src).toMatch(/status:\s*'deciding'/)
    expect(src).toMatch(/stage:\s*FINAL_STAGE/)
  })
})
