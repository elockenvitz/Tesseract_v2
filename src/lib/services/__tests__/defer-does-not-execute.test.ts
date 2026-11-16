/**
 * A deferral is a decision. It is not an execution.
 *
 * `updateDecisionRequest` is where accept, reject, defer and withdraw all
 * converge — the place `decision.recorded` is emitted precisely because "a
 * writer per call site is a writer someone forgets to add to the fifth". That
 * makes it the one function where a future change could accidentally give a
 * non-accepting ruling an execution side effect, and `markDRAccepted` doing
 * trade work lives one module away.
 *
 * Rejection is already covered end to end in `pilot-assumed-execution`
 * ("rejection decides without executing"), which runs the real
 * `rejectFromInbox`. Deferral had nothing: the existing deferral tests
 * (`lifecycle-memory-wiring`) use a double with no holdings tables in it at
 * all, so they could not have noticed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}))

const memory = vi.hoisted(() => ({
  decisions: [] as Array<Record<string, unknown>>,
  obligations: [] as Array<Record<string, unknown>>,
}))

const has = (ops: Op[], name: string) => ops.some(([op]) => op === name)

vi.mock('../../supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-pm' } } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpc.push({ fn, args })
      return { data: null, error: null }
    },
    from: (table: string) => {
      const call = { table, ops: [] as Op[] }
      db.calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of [
        'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'in',
        'order', 'limit', 'maybeSingle', 'single',
      ]) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        let data: unknown = null
        if (table === 'decision_requests' && has(call.ops, 'update')) {
          data = {
            id: 'dr-1',
            portfolio_id: 'p1',
            trade_queue_item_id: 'tqi-1',
            proposal_id: 'prop-1',
            status: 'deferred',
            reviewed_at: '2026-11-16T10:00:00Z',
            deferred_until: '2026-12-01',
            deferred_trigger: null,
          }
        }
        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  },
}))

vi.mock('../../memory/lifecycle-events', () => ({
  recordDecisionRecorded: vi.fn(async (input: Record<string, unknown>) => {
    memory.decisions.push(input)
  }),
  resolveOrganizationIdForPortfolio: vi.fn(async () => 'org-1'),
}))

vi.mock('../../memory/obligation-writer', () => ({
  syncDecisionRevisitObligation: vi.fn(async (input: Record<string, unknown>) => {
    memory.obligations.push(input)
  }),
}))

import { updateDecisionRequest } from '../decision-request-service'

const defer = () => updateDecisionRequest('dr-1', {
  status: 'deferred',
  deferredUntil: '2026-12-01',
} as never)

beforeEach(() => {
  db.calls = []; db.rpc = []
  memory.decisions = []; memory.obligations = []
})

describe('deferring a recommendation does not touch holdings', () => {
  it('calls no holdings RPC', async () => {
    await defer()
    expect(db.rpc).toHaveLength(0)
  })

  it('writes to no holdings table', async () => {
    await defer()
    const touched = new Set(db.calls.map(c => c.table))
    expect(touched.has('portfolio_holdings')).toBe(false)
    expect(touched.has('portfolio_holdings_positions')).toBe(false)
    expect(touched.has('portfolio_holdings_snapshots')).toBe(false)
  })

  it('creates no accepted trade', async () => {
    // The committed-trade record is the thing that moves the book. A deferral
    // that produced one would be an execution wearing a decision's name.
    await defer()
    expect(db.calls.filter(c => c.table === 'accepted_trades')).toHaveLength(0)
  })

  it('writes no execution evidence', async () => {
    await defer()
    expect(db.calls.filter(c => c.table === 'portfolio_trade_events')).toHaveLength(0)
  })

  it('touches only the request itself', async () => {
    await defer()
    expect([...new Set(db.calls.map(c => c.table))]).toEqual(['decision_requests'])
  })
})

describe('it is still recorded as a decision', () => {
  it('emits decision.recorded with the deferred status', async () => {
    /*
     * The complement of the assertions above, and the reason they are not
     * just "the function does nothing". A deferral IS a ruling and must reach
     * organisational memory; what it must not reach is the book.
     */
    await defer()
    expect(memory.decisions).toHaveLength(1)
    expect(memory.decisions[0].status).toBe('deferred')
    expect(memory.decisions[0].decisionRequestId).toBe('dr-1')
  })

  it('emits no execution event of any kind', async () => {
    await defer()
    // `recordExecutionRecorded` is not even imported by this module. If that
    // changes, this mock factory stops matching and the suite fails loudly.
    expect(Object.keys(memory)).toEqual(['decisions', 'obligations'])
  })

  it('raises a revisit obligation, so the deferral is not forgotten', async () => {
    await defer()
    expect(memory.obligations).toHaveLength(1)
    expect(memory.obligations[0].stillDeferred).toBe(true)
  })
})
