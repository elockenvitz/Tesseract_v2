/**
 * The one execution-evidence read, and the authorization it inherits.
 *
 * `fetchExecutionProofsForTrades` is what Outcomes, decisions-v2 and the EOD
 * reconciler now use instead of reading `accepted_trades.execution_status` and
 * calling it a fill. It reads `portfolio_trade_events` on the CALLER'S client,
 * so the existing RLS on that table decides what comes back and no surface
 * gains sight of another organisation's evidence.
 *
 * Two properties matter more than the happy path:
 *
 *  - A denial or a failure must cost a QUALIFIER, never a page. The surfaces
 *    that call this render trades; if the evidence read throws, the trades
 *    disappear, and a blank Outcomes page is a worse answer than an unbadged
 *    one.
 *  - An absence must stay an absence. No grade may be invented for a trade
 *    whose evidence this reader cannot see, because every consumer renders a
 *    grade as a claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = [string, unknown[]]

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Op[] }>,
  rows: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
  throws: false,
}))

vi.mock('../../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, ops: [] as Op[] }
      db.calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'in', 'eq']) {
        chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain }
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (db.throws) throw new Error('network is down')
        return Promise.resolve({ data: db.rows, error: db.error }).then(resolve)
      }
      return chain
    },
  },
}))

import { fetchExecutionProofsForTrades } from '../../asset-decisions/execution-evidence'

const ev = (tradeId: string, origin: string) => ({
  metadata: { origin, accepted_trade_id: tradeId },
  detected_by_system: false,
  source_type: 'manual',
})

beforeEach(() => {
  db.calls = []
  db.rows = []
  db.error = null
  db.throws = false
})

describe('it reads evidence through the caller\'s own client', () => {
  it('queries portfolio_trade_events, keyed on the trade ids it was given', async () => {
    db.rows = [ev('at-1', 'pm_assumed_execution')]
    await fetchExecutionProofsForTrades(['at-1', 'at-2'])

    const read = db.calls.find(c => c.table === 'portfolio_trade_events')
    expect(read).toBeTruthy()
    const filter = read!.ops.find(([op]) => op === 'in')
    expect(filter![1][0]).toBe('metadata->>accepted_trade_id')
    expect(filter![1][1]).toEqual(['at-1', 'at-2'])
  })

  it('uses no other table, and no second client', async () => {
    /*
     * The authorization story is "the same client the surface already uses, so
     * the same RLS". A read of `portfolios` or `accepted_trades` to widen the
     * set, or a service-role client, would break that, and it is the kind of
     * thing added later for convenience.
     */
    db.rows = [ev('at-1', 'pm_assumed_execution')]
    await fetchExecutionProofsForTrades(['at-1'])
    expect([...new Set(db.calls.map(c => c.table))]).toEqual(['portfolio_trade_events'])
  })

  it('reads nothing at all when given no trades', async () => {
    const proofs = await fetchExecutionProofsForTrades([])
    expect(proofs.size).toBe(0)
    expect(db.calls).toHaveLength(0)
  })

  it('de-duplicates ids rather than asking twice', async () => {
    await fetchExecutionProofsForTrades(['at-1', 'at-1', 'at-1'])
    const filter = db.calls[0].ops.find(([op]) => op === 'in')
    expect(filter![1][1]).toEqual(['at-1'])
  })
})

describe('a denial or a failure costs a qualifier, not a page', () => {
  it('returns an empty map when RLS refuses the read', async () => {
    // What a reader authorised for the trade but not its evidence gets. The
    // consumer then renders the unqualified status, which is the behaviour
    // that existed before this reader — a loss of detail, never a false claim.
    db.error = { message: 'permission denied for table portfolio_trade_events' }
    const proofs = await fetchExecutionProofsForTrades(['at-1'])
    expect(proofs.size).toBe(0)
  })

  it('does not throw when the query itself throws', async () => {
    db.throws = true
    await expect(fetchExecutionProofsForTrades(['at-1'])).resolves.toBeInstanceOf(Map)
  })

  it('never invents a grade for a trade it cannot see', async () => {
    db.rows = [ev('at-1', 'pm_assumed_execution')]
    const proofs = await fetchExecutionProofsForTrades(['at-1', 'at-2'])
    expect(proofs.get('at-1')).toBe('assumed')
    // `at-2` was asked for and came back with nothing. Absent, not defaulted.
    expect(proofs.has('at-2')).toBe(false)
  })
})

describe('it grades each trade from its own rows', () => {
  it('keeps two trades apart', async () => {
    db.rows = [ev('at-1', 'pm_assumed_execution'), ev('at-2', 'trader_attested')]
    const proofs = await fetchExecutionProofsForTrades(['at-1', 'at-2'])
    expect(proofs.get('at-1')).toBe('assumed')
    expect(proofs.get('at-2')).toBe('attested')
  })

  it('takes the strongest row for a trade that has several', async () => {
    db.rows = [ev('at-1', 'pm_assumed_execution'), ev('at-1', 'trader_attested')]
    const proofs = await fetchExecutionProofsForTrades(['at-1'])
    expect(proofs.get('at-1')).toBe('attested')
  })
})
