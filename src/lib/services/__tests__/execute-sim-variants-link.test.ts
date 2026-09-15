/**
 * Trade Lab Execute links the decision request to the trade it created.
 *
 * The request is resolved (an existing pending one) or created (self-proposed)
 * before `createAcceptedTrade` runs, and nothing came back to write
 * `decision_requests.accepted_trade_id`. Desktop Decisions reads execution
 * through that FK, so an executed Trade Lab trade read "Never executed".
 *
 * Runs the real `executeSimVariants` over a recording Supabase double.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]
const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  order: [] as string[],
}))

const has = (ops: Op[], name: string) => ops.some(([op]) => op === name)

vi.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, ops: [] as Op[] }
      db.calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'maybeSingle', 'single']) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'decision_requests' && has(call.ops, 'update')) db.order.push(`update:${JSON.stringify(call.ops.find(([o]) => o === 'update')![1][0])}`)
        let data: unknown = null
        if (table === 'trade_batches' && has(call.ops, 'insert')) data = { id: 'b-1', portfolio_id: 'p1' }
        else if (table === 'decision_requests' && has(call.ops, 'insert')) data = { id: 'dr-new' }
        else if (table === 'decision_requests' && has(call.ops, 'maybeSingle')) {
          const byId = call.ops.find(([op, a]) => op === 'eq' && a[0] === 'id')
          data = byId ? { id: byId[1][1], status: 'pending' } : null
        } else if (table === 'portfolios') data = { holdings_source: 'live_feed' }
        else if (has(call.ops, 'select') && !has(call.ops, 'single') && !has(call.ops, 'maybeSingle')) data = []
        return Promise.resolve({ data, error: null }).then(resolve)
      }
      return chain
    },
  },
}))

vi.mock('../accepted-trade-service', () => ({
  createAcceptedTrade: vi.fn(async (input: { decision_request_id: string; asset_id: string }) => {
    db.order.push(`createAcceptedTrade:${input.decision_request_id}`)
    return { id: `at-for-${input.decision_request_id}`, asset_id: input.asset_id }
  }),
}))
vi.mock('../intent-variant-service', () => ({ deleteVariant: vi.fn(async () => {}) }))

import { executeSimVariants } from '../execute-sim-variants-service'

const variant = (over: Record<string, unknown> = {}) => ({
  id: 'v-1', portfolio_id: 'p1', asset_id: 'a-aapl', action: 'add',
  sizing_input: '+1', sizing_spec: null, notes: null,
  computed: { target_weight: 3, target_shares: 100, delta_weight: 1, delta_shares: 30, notional_value: 6000, price_used: 200 },
  trade_queue_item_id: 'tq-1', proposal_id: null, decision_request_id: null,
  asset: { symbol: 'AAPL' },
  ...over,
}) as never

const ctx = { actorId: 'u1', actorName: 'Pilot' } as never

const linkUpdates = () => db.calls.filter(c =>
  c.table === 'decision_requests'
  && c.ops.some(([op, a]) => op === 'update' && (a[0] as Record<string, unknown>).accepted_trade_id !== undefined)
  && !c.ops.some(([op]) => op === 'in'),
)

beforeEach(() => { db.calls.length = 0; db.order.length = 0 })

describe('Trade Lab Execute persists request ↔ trade', () => {
  it('links a self-proposed request to its trade, after the trade exists', async () => {
    await executeSimVariants({ variants: [variant()], portfolioId: 'p1', context: ctx })
    const links = linkUpdates()
    expect(links).toHaveLength(1)
    const ops = links[0].ops
    expect(ops.find(([op]) => op === 'update')![1][0]).toMatchObject({ accepted_trade_id: 'at-for-dr-new' })
    expect(ops).toContainEqual(['eq', ['id', 'dr-new']])
    // Never repoints a request that some other path already linked.
    expect(ops).toContainEqual(['is', ['accepted_trade_id', null]])
    const created = db.order.indexOf('createAcceptedTrade:dr-new')
    const linked = db.order.findIndex(e => e.includes('"accepted_trade_id":"at-for-dr-new"'))
    expect(created).toBeGreaterThan(-1)
    expect(linked).toBeGreaterThan(created)
  })

  it('links an existing pending request that Execute accepted', async () => {
    await executeSimVariants({ variants: [variant({ decision_request_id: 'dr-pending' })], portfolioId: 'p1', context: ctx })
    const links = linkUpdates()
    expect(links).toHaveLength(1)
    expect(links[0].ops.find(([op]) => op === 'update')![1][0]).toMatchObject({ accepted_trade_id: 'at-for-dr-pending' })
    expect(links[0].ops).toContainEqual(['eq', ['id', 'dr-pending']])
    // The accept itself still carries the provenance string, not a reason.
    expect(db.order.some(e => e.includes('"decision_note":"Accepted via Trade Lab Execute"'))).toBe(true)
  })
})
