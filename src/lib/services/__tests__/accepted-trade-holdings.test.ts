import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A trade that did not move the book must not report that it did.
 *
 * ── What the writer used to be ────────────────────────────────────────────
 *
 * `applyTradeToHoldings` issued its own insert, update and delete against
 * `portfolio_holdings`, looking the position up with `.eq('date', today)`.
 * Three failures rode on that:
 *
 *   - It never read `error`, inside a `try` whose `catch` only warned.
 *   - RLS matching no rows is not an error, so a refused write and a
 *     completed one were indistinguishable.
 *   - A position last written yesterday read as zero shares, so a delta
 *     resized it from nothing and a full exit deleted nothing at all.
 *
 * In every case the caller went on to stamp the trade complete and matched
 * and emit a trade event claiming an execution.
 *
 * ── What it is now ────────────────────────────────────────────────────────
 *
 * One call to `apply_trade_to_book`, which does the read, the arithmetic and
 * the write in a single transaction with no date in the lookup. These tests
 * pin what the service does with its answer, which is the half that lives in
 * TypeScript. The arithmetic itself is pinned against a real database in
 * supabase/tests/holdings-working-book.sql.
 */

interface Call {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  filters: Record<string, unknown>
  payload?: Record<string, unknown>
}

const calls: Call[] = []
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

/** Keyed `table:op`. Anything unset resolves to an empty success. */
let responses: Record<string, { data: unknown; error: unknown }> = {}
/** Keyed by function name. */
let rpcResponses: Record<string, { data: unknown; error: unknown }> = {}

const EMPTY = { data: null, error: null }

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: {} }
  let recorded = false

  const record = () => { if (!recorded) { calls.push(call); recorded = true } }
  const result = () => {
    record()
    return Promise.resolve(responses[`${table}:${call.op}`] ?? EMPTY)
  }

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
  supabase: {
    from: (t: string) => builder(t),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(rpcResponses[fn] ?? EMPTY)
    },
  },
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

const applyCall = () => rpcCalls.find(c => c.fn === 'apply_trade_to_book')

const applied = (over: Record<string, unknown> = {}) => ({
  data: {
    applied: true, reason: null, shares_before: 1000, shares_after: 1200,
    price_used: 100, action: 'resize', ...over,
  },
  error: null,
})

beforeEach(() => {
  calls.length = 0
  rpcCalls.length = 0
  responses = {
    'accepted_trades:insert': { data: [TRADE], error: null },
    'portfolios:select': { data: [{ holdings_source: 'manual_eod' }], error: null },
    'accepted_trades:update': { data: [{ ...TRADE }], error: null },
  }
  rpcResponses = { apply_trade_to_book: applied() }
})

describe('the book is moved through the transactional operation', () => {
  it('calls apply_trade_to_book rather than writing rows itself', () => {
    return createAcceptedTrade(INPUT).then(() => {
      expect(applyCall()).toBeTruthy()
      // No direct DML on the table. Anything that reaches portfolio_holdings
      // outside the RPC is outside the transaction and outside the gate.
      expect(calls.some(c => c.table === 'portfolio_holdings')).toBe(false)
    })
  })

  it('passes both size fields through and lets the book decide', () => {
    return createAcceptedTrade(INPUT).then(() => {
      expect(applyCall()!.args).toMatchObject({
        p_portfolio_id: 'p1',
        p_asset_id: 'a1',
        p_target_shares: 1200,
        p_delta_shares: 200,
      })
      // No date argument exists to send. That is the fix for the stale-dated
      // position, expressed as an absence.
      expect(Object.keys(applyCall()!.args)).not.toContain('p_date')
    })
  })

  it('never mutates snapshot history', async () => {
    await createAcceptedTrade(INPUT)
    // The old writer upserted into the newest snapshot's positions in place,
    // which is why the one artifact that looked like history was not.
    expect(calls.some(c => c.table === 'portfolio_holdings_positions')).toBe(false)
    expect(calls.some(c => c.table === 'portfolio_holdings_snapshots')).toBe(false)
  })
})

describe('a book that did not move', () => {
  it('does not mark the trade complete when the operation is refused', async () => {
    rpcResponses.apply_trade_to_book = {
      data: null,
      error: { message: 'Not authorized to write the book for portfolio p1' },
    }

    await createAcceptedTrade(INPUT)

    const stamp = finalizeUpdate()
    expect(stamp?.payload?.reconciliation_status).toBe('unmatched')
    expect(stamp?.payload).not.toHaveProperty('execution_status')
    expect(String((stamp?.payload?.reconciliation_detail as any)?.holdings_apply_error))
      .toContain('Not authorized')
  })

  it('never emits a trade event for a book that did not move', async () => {
    rpcResponses.apply_trade_to_book = { data: null, error: { message: 'refused' } }

    await createAcceptedTrade(INPUT)

    // Decision Accountability matches decisions against these rows. One here
    // would report an execution that did not happen.
    expect(calls.some(c => c.table === 'portfolio_trade_events' && c.op === 'insert')).toBe(false)
  })

  it('treats an empty response as a failure, not a success', async () => {
    rpcResponses.apply_trade_to_book = { data: null, error: null }

    await createAcceptedTrade(INPUT)

    expect(finalizeUpdate()?.payload?.reconciliation_status).toBe('unmatched')
  })
})

describe('STAGE 2 DEFECT 2 — a trade with no size', () => {
  it('is not marked executed, and is not marked failed either', async () => {
    // 4 production trades carry neither target_shares nor delta_shares. The
    // book cannot reflect them, so `complete` and `matched` would both be
    // false claims — but nothing went wrong, so `unmatched` would be one too.
    rpcResponses.apply_trade_to_book = {
      data: { applied: false, reason: 'no_size', shares_before: 0, shares_after: 0, action: 'none' },
      error: null,
    }

    await createAcceptedTrade({ ...INPUT, target_shares: null, delta_shares: null })

    // reconciliation_status keeps its inserted 'pending': a real commitment
    // the book has yet to reflect.
    expect(finalizeUpdate()).toBeUndefined()
  })

  it('emits no trade event either', async () => {
    rpcResponses.apply_trade_to_book = {
      data: { applied: false, reason: 'no_size', shares_before: 0, shares_after: 0, action: 'none' },
      error: null,
    }

    await createAcceptedTrade({ ...INPUT, target_shares: null, delta_shares: null })

    expect(calls.some(c => c.table === 'portfolio_trade_events' && c.op === 'insert')).toBe(false)
  })
})

describe('a book that did move', () => {
  it('marks the trade complete and matched', async () => {
    await createAcceptedTrade(INPUT)

    const stamp = finalizeUpdate()
    expect(stamp?.payload?.execution_status).toBe('complete')
    expect(stamp?.payload?.reconciliation_status).toBe('matched')
  })

  it('reports a full exit as applied', async () => {
    rpcResponses.apply_trade_to_book = applied({
      shares_before: 1000, shares_after: 0, action: 'exit',
    })

    await createAcceptedTrade({ ...INPUT, action: 'sell', target_shares: 0, delta_shares: -1000 })

    expect(finalizeUpdate()?.payload?.execution_status).toBe('complete')
  })
})

describe('HoldingsWriteError', () => {
  it('names the operation, so a failure is diagnosable from the trade row', () => {
    const e = new HoldingsWriteError('apply', 'the write was refused')
    expect(e.operation).toBe('apply')
    expect(e.message).toContain('portfolio_holdings apply failed')
    expect(e).toBeInstanceOf(Error)
  })
})
