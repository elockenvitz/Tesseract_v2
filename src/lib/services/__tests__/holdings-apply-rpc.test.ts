/**
 * Applying a committed trade to portfolio_holdings.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * portfolio_holdings is a series of dated snapshots. `applyTradeToHoldings`
 * looked for a row at (portfolio, asset, CURRENT_DATE) and inserted one when
 * it found nothing — which, on the first trade of any day, it always does. So
 * the first execute of a new date wrote a snapshot containing ONE position and
 * stranded every other holding on the previous date.
 *
 * `latestSnapshotRows` then correctly returned that single row as "current
 * holdings", Trade Lab re-snapshotted its baseline from it, and the traded
 * name showed at 100% with everything else as NEW at 0%. Observed in
 * production on 2026-09-13: portfolio 9d1d88db held one row, AAPL.
 *
 * Two more defects in the same function: `shares_before` read 0 on a new date,
 * so a pure-delta trade wrote the delta as the whole position; and cash was
 * never adjusted, so the book did not balance.
 *
 * ── Why these are source assertions ──────────────────────────────────────
 *
 * The fix is a Postgres function, and the behaviour that matters — rollover,
 * arithmetic, cash, liquidation — is asserted against a real database in
 * supabase/tests/apply-trade-to-holdings.sql, which runs in psql.
 *
 * What CI can enforce is that the client goes through the RPC rather than
 * writing rows itself, and that the function keeps the properties the fix
 * depends on: the lock, the completeness of the carry-forward, the realised
 * delta, invoker rights. Those are the things a later edit would quietly undo,
 * and each one of them failing means the production bug is back.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const service = src('lib/services/accepted-trade-service.ts')

const migrationName = readdirSync(path.join(process.cwd(), 'supabase', 'migrations'))
  .find(f => f.includes('apply_trade_to_holdings_rpc'))
const migration = readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', migrationName ?? 'missing'),
  'utf8',
)

/** The body of applyTradeToHoldings, up to the snapshots section it still owns. */
const applyFn = (() => {
  const start = service.indexOf('async function applyTradeToHoldings(')
  const end = service.indexOf('── portfolio_holdings_snapshots', start)
  return service.slice(start, end)
})()

describe('the client no longer writes holdings itself', () => {
  it('applies the trade through the RPC', () => {
    expect(applyFn).toContain("supabase.rpc('apply_trade_to_holdings'")
    for (const arg of ['p_portfolio_id', 'p_asset_id', 'p_target_shares', 'p_delta_shares', 'p_price']) {
      expect(applyFn).toContain(arg)
    }
  })

  /**
   * The read-then-write that could not be made safe. Four statements against
   * portfolio_holdings, with a Promise.all batch running N of them at once.
   */
  it('keeps no direct portfolio_holdings statements in the apply path', () => {
    expect(applyFn).not.toContain("from('portfolio_holdings')")
  })

  /** A refused write must not read as an applied one. */
  it('surfaces a failed apply instead of continuing', () => {
    expect(applyFn).toContain('if (applyError) {')
    expect(applyFn).toContain('throw new Error(')
  })

  /** shares_before / shares_after now come from the database, not a local read. */
  it('reports the position movement the database actually made', () => {
    expect(applyFn).toContain("result.shares_before")
    expect(applyFn).toContain("result.shares_after")
  })
})

describe('the function keeps the properties the fix depends on', () => {
  /**
   * Without this, a concurrent batch has N callers each observing an empty
   * date and each cloning the prior one — N duplicate sets, which is worse
   * than the bug being fixed.
   */
  it('serialises applies per portfolio', () => {
    expect(migration).toContain('pg_advisory_xact_lock(hashtext(p_portfolio_id::text))')
    // Transaction-scoped: it must not be a session lock that outlives the call.
    expect(migration).not.toContain('pg_advisory_lock(')
  })

  /** The whole prior date, or none of it. A filtered copy is the original bug. */
  it('carries the complete prior snapshot forward', () => {
    const roll = migration.slice(migration.indexOf('INSERT INTO portfolio_holdings (portfolio_id, asset_id, shares, price, cost, date)'))
    const stmt = roll.slice(0, roll.indexOf(';'))
    expect(stmt).toContain('SELECT portfolio_id, asset_id, shares, price, cost, v_today')
    expect(stmt).toContain('WHERE portfolio_id = p_portfolio_id AND date = v_last')
    // No asset filter — that would reproduce the partial date.
    expect(stmt).not.toContain('asset_id = p_asset_id')
  })

  /** Guarded on the DATE being unpopulated, not on this asset's row. */
  it('rolls forward once per date, not once per trade', () => {
    expect(migration).toContain('IF NOT EXISTS (\n    SELECT 1 FROM portfolio_holdings\n     WHERE portfolio_id = p_portfolio_id AND date = v_today\n  ) THEN')
  })

  /** target is absolute; delta is relative to the carried-forward position. */
  it('applies target or delta exactly once', () => {
    expect(migration).toContain('v_new := COALESCE(p_target_shares, v_before + COALESCE(p_delta_shares, 0));')
  })

  /**
   * From the realised movement, not from delta_shares: a target_shares trade
   * carries no meaningful delta, and a liquidation's is whatever the client
   * guessed. Buys make this positive and debit cash; sells credit it.
   */
  it('moves cash by the position delta that actually happened', () => {
    expect(migration).toContain('v_cash_delta := (v_after - v_before) * p_price;')
    expect(migration).toContain('SET shares = shares - v_cash_delta')
    expect(migration).toContain("a.symbol = 'CASH_USD'")
  })

  /** RLS posture unchanged: the caller's policies, not the definer's. */
  it('runs with invoker rights', () => {
    expect(migration).toContain('SECURITY INVOKER')
    expect(migration).not.toContain('SECURITY DEFINER')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.apply_trade_to_holdings')
    // Supabase grants anon EXECUTE explicitly; a PUBLIC revoke leaves it.
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.apply_trade_to_holdings(uuid, uuid, numeric, numeric, numeric) FROM anon')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.apply_trade_to_holdings(uuid, uuid, numeric, numeric, numeric) TO authenticated')
  })

  /** A zero-or-below target closes the position rather than storing 0 shares. */
  it('closes a liquidated position', () => {
    expect(migration).toContain('IF v_new <= 0 THEN')
    expect(migration).toContain('DELETE FROM portfolio_holdings')
  })

  /**
   * The old client did `trade.price_at_acceptance || 0`, which stored a
   * worthless position and settled the cash leg for free. A trade whose price
   * we do not know is one we cannot apply correctly.
   */
  it('refuses to apply a trade with no usable price', () => {
    expect(migration).toContain('IF p_price IS NULL OR p_price <= 0 THEN')
    // And nothing downstream papers over a missing price any more.
    const body = migration.slice(migration.indexOf('PERFORM pg_advisory_xact_lock'))
    expect(body).not.toContain('COALESCE(p_price, 0)')
    expect(body).toContain('v_cash_delta := (v_after - v_before) * p_price;')
  })

  /**
   * CURRENT_DATE is the session's date, and a PostgREST connection's TimeZone
   * is whatever the role was configured with. The client this replaces used
   * toISOString(), and the audit read UTC dates — three notions of "today"
   * over one dated table is how a near-midnight trade starts a second partial
   * snapshot for a day that already has one.
   */
  it('decides the day in UTC, not from the session', () => {
    expect(migration).toContain("v_today       date := (now() AT TIME ZONE 'UTC')::date;")
    expect(migration).not.toMatch(/:=\s*CURRENT_DATE/)
    // The catalogue comment is what a reader of the live function sees.
    expect(migration).not.toMatch(/portfolio_holdings at CURRENT_DATE/)
    expect(migration).toContain('portfolio_holdings at the current UTC date')
  })
})

describe('the database tests cover the scenarios the RPC exists for', () => {
  const sql = readFileSync(
    path.join(process.cwd(), 'supabase', 'tests', 'apply-trade-to-holdings.sql'),
    'utf8',
  )

  it('names each one', () => {
    for (const claim of [
      'carries the COMPLETE prior snapshot forward',
      'does not roll forward again',
      'no duplicate date',
      'target_shares sets the position absolutely',
      'pure delta_shares moves the CARRIED-FORWARD position',
      'a buy debits cash, a sell credits it',
      'liquidation removes the row',
      'no usable price is refused',
      'the day is decided in UTC',
    ]) {
      expect(sql).toContain(claim)
    }
  })

  /**
   * One psql session is one transaction at a time, so the batch case proves
   * the invariant a race must preserve, not the lock under contention. Said
   * out loud in the file, because a test that looks like it covers a race and
   * does not is worse than no test.
   */
  it('is honest about what it cannot prove', () => {
    expect(sql).toContain('What these cannot prove')
    expect(sql).toContain('enforces it under real contention')
  })
})
