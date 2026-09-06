import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A trade that did not move the book must not report that it did.
 *
 * ── What went wrong ───────────────────────────────────────────────────────
 *
 * `applyTradeToHoldings` issued its insert, update and delete without ever
 * reading the returned `error`, inside a `try` whose `catch` only warned. Two
 * separate failures were invisible:
 *
 *   1. PostgREST returning an error — swallowed.
 *   2. RLS matching no rows — not even an error. The old UPDATE and DELETE
 *      policies required `auth.uid() = created_by` or org-admin, so a
 *      non-admin PM trading against a position created during onboarding
 *      matched nothing at all, silently.
 *
 * In both cases the caller went on to stamp the trade
 * `execution_status='complete'` and `reconciliation_status='matched'`, and to
 * emit a portfolio_trade_events row that told Decision Accountability the
 * trade had executed. Three claims about a book that had not changed.
 *
 * These tests pin the fix: the write reports what it touched, a write that
 * touched nothing raises, and the trade is left visible as `unmatched`
 * instead of being marked complete.
 */

interface Call {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  filters: Record<string, unknown>
  payload?: Record<string, unknown>
}

const calls: Call[] = []

/** Keyed `table:op`. Anything unset resolves to an empty success. */
let responses: Record<string, { data: unknown; error: unknown }> = {}

const EMPTY = { data: null, error: null }

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: {} }
  let recorded = false

  const record = () => {
    if (!recorded) { calls.push(call); recorded = true }
  }
  const result = () => {
    record()
    return Promise.resolve(responses[`${table}:${call.op}`] ?? EMPTY)
  }

  // Every method returns the same object, and the object is awaitable. Real
  // PostgREST builders behave this way: `.update(...).eq(...).select('id')`
  // resolves, and so does `.update(...).eq(...)` on its own.
  const api: any = {
    select: () => api,
    insert: (payload: Record<string, unknown>) => { call.op = 'insert'; call.payload = payload; return api },
    upsert: (payload: Record<string, unknown>) => { call.op = 'insert'; call.payload = payload; return api },
    update: (payload: Record<string, unknown>) => { call.op = 'update'; call.payload = payload; return api },
    delete: () => { call.op = 'delete'; return api },
    eq: (col: string, val: unknown) => { call.filters[col] = val; return api },
    in: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: () => result().then((r: any) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data })),
    single: () => result().then((r: any) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data })),
    then: (onOk: any, onErr: any) => result().then(onOk, onErr),
  }
  return api
}

vi.mock('../../supabase', () => ({
  supabase: { from: (t: string) => builder(t) },
}))

import { createAcceptedTrade, HoldingsWriteError } from '../accepted-trade-service'

const TRADE = {
  id: 'trade-1',
  portfolio_id: 'p1',
  asset_id: 'a1',
  action: 'add',
  target_shares: 1200,
  delta_shares: 200,
  price_at_acceptance: 100,
}

const INPUT = {
  portfolio_id: 'p1',
  asset_id: 'a1',
  action: 'add' as const,
  source: 'simulation' as const,
  accepted_by: 'pm-1',
  target_shares: 1200,
  delta_shares: 200,
  price_at_acceptance: 100,
}

/** The write of record: the stamp that says the book agrees with the trade. */
const finalizeUpdate = () =>
  calls.find(c => c.table === 'accepted_trades' && c.op === 'update')

beforeEach(() => {
  calls.length = 0
  responses = {
    'accepted_trades:insert': { data: [TRADE], error: null },
    'portfolios:select': { data: [{ holdings_source: 'manual_eod' }], error: null },
    'accepted_trades:update': { data: [{ ...TRADE }], error: null },
  }
})

describe('a holdings write that touched nothing', () => {
  it('does not mark the trade complete when the update matched no rows', async () => {
    // The row exists, so the writer takes the UPDATE branch...
    responses['portfolio_holdings:select'] = { data: [{ id: 'h1', shares: 1000, price: 95 }], error: null }
    // ...and RLS refuses it the way RLS does: no error, no rows.
    responses['portfolio_holdings:update'] = { data: [], error: null }

    const trade = await createAcceptedTrade(INPUT)

    const stamp = finalizeUpdate()
    expect(stamp?.payload?.reconciliation_status).toBe('unmatched')
    expect(stamp?.payload).not.toHaveProperty('execution_status')
    expect(stamp?.payload?.reconciled_at).toBeNull()
    expect(trade).toBeTruthy()
  })

  it('does not mark the trade complete when the delete matched no rows', async () => {
    responses['portfolio_holdings:select'] = { data: [{ id: 'h1', shares: 1000, price: 95 }], error: null }
    responses['portfolio_holdings:delete'] = { data: [], error: null }

    await createAcceptedTrade({ ...INPUT, action: 'sell', target_shares: 0, delta_shares: -1000 })

    expect(finalizeUpdate()?.payload?.reconciliation_status).toBe('unmatched')
  })

  it('does not mark the trade complete when the insert is refused', async () => {
    responses['portfolio_holdings:select'] = { data: [], error: null }
    responses['portfolio_holdings:insert'] = { data: null, error: { message: 'new row violates row-level security policy' } }

    await createAcceptedTrade(INPUT)

    const stamp = finalizeUpdate()
    expect(stamp?.payload?.reconciliation_status).toBe('unmatched')
    expect(String((stamp?.payload?.reconciliation_detail as any)?.holdings_apply_error))
      .toContain('row-level security')
  })

  it('records the failure on the trade rather than only in the console', async () => {
    responses['portfolio_holdings:select'] = { data: [{ id: 'h1', shares: 1000, price: 95 }], error: null }
    responses['portfolio_holdings:update'] = { data: [], error: null }

    await createAcceptedTrade(INPUT)

    const detail = finalizeUpdate()?.payload?.reconciliation_detail as any
    expect(detail?.holdings_apply_error).toMatch(/update failed/)
  })

  it('never emits a trade event for a book that did not move', async () => {
    responses['portfolio_holdings:select'] = { data: [{ id: 'h1', shares: 1000, price: 95 }], error: null }
    responses['portfolio_holdings:update'] = { data: [], error: null }

    await createAcceptedTrade(INPUT)

    // Decision Accountability matches decisions against these rows. One here
    // would report an execution that did not happen.
    expect(calls.some(c => c.table === 'portfolio_trade_events' && c.op === 'insert')).toBe(false)
  })
})

describe('a read that failed is not an empty book', () => {
  it('refuses to insert over a position it could not see', async () => {
    responses['portfolio_holdings:select'] = { data: null, error: { message: 'permission denied' } }

    await createAcceptedTrade(INPUT)

    // The old code read `{ data: existing }` with no error binding, so a
    // failed read looked identical to "no position yet" and it inserted a
    // fresh row on top of a live one.
    expect(calls.some(c => c.table === 'portfolio_holdings' && c.op === 'insert')).toBe(false)
    expect(finalizeUpdate()?.payload?.reconciliation_status).toBe('unmatched')
  })
})

describe('a holdings write that landed', () => {
  it('marks the trade complete and matched', async () => {
    responses['portfolio_holdings:select'] = { data: [{ id: 'h1', shares: 1000, price: 95 }], error: null }
    responses['portfolio_holdings:update'] = { data: [{ id: 'h1' }], error: null }

    await createAcceptedTrade(INPUT)

    const stamp = finalizeUpdate()
    expect(stamp?.payload?.execution_status).toBe('complete')
    expect(stamp?.payload?.reconciliation_status).toBe('matched')
  })

  it('marks the trade complete when a new position was inserted', async () => {
    responses['portfolio_holdings:select'] = { data: [], error: null }
    responses['portfolio_holdings:insert'] = { data: [{ id: 'h-new' }], error: null }

    await createAcceptedTrade(INPUT)

    expect(finalizeUpdate()?.payload?.execution_status).toBe('complete')
  })
})

describe('HoldingsWriteError', () => {
  it('names the operation, so a failure is diagnosable from the trade row', () => {
    const e = new HoldingsWriteError('delete', 'the write was refused')
    expect(e.operation).toBe('delete')
    expect(e.message).toContain('portfolio_holdings delete failed')
    expect(e).toBeInstanceOf(Error)
  })
})
