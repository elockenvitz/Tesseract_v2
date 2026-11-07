/**
 * Whether the trade-price audit can be trusted with the question it answers.
 *
 * Two things are tested, and both exist because the first version of the
 * script got them wrong.
 *
 * ── 1. It must not be able to write ──────────────────────────────────────
 *
 * The audit answers "do holdings, cash and outcomes need correcting" and the
 * standing instruction is not to modify historical data.
 *
 * There are two layers and it matters which is which. The BOUNDARY is the
 * database: every request carries `read_only: true`, so postgres rejects a
 * write itself with SQLSTATE 25006. `readQueryBody` is tested below for
 * exactly that flag, because a request body that silently lost it is a
 * request that can write.
 *
 * `assertReadOnly` is the TRIPWIRE in front of it, and a keyword denylist is
 * not a security boundary. An earlier version of this file claimed the
 * read-only behaviour was "enforced" by that denylist alone. It was not: a
 * review fed it four statements that write while spelled as ordinary
 * SELECTs, and all four were accepted --
 *
 *   select * into stolen_trades from accepted_trades      creates a table
 *   select public.apply_trade_to_holdings(...)            moves holdings
 *   select setval('some_seq', 1)                          rewinds a sequence
 *   select pg_terminate_backend(1)                        kills a connection
 *
 * Three of those are now named in the denylist and are tested here. The
 * second deliberately is not: any volatile function can write and naming
 * them one at a time is a losing game, so that one is left to the read-only
 * transaction. Passing the tripwire is not proof a statement is safe.
 *
 * ── 2. It must classify the one trade that matters ───────────────────────
 *
 * `classifyTrade` originally tried to be clever: a price of exactly 100 was
 * forgiven if the dated close corroborated it within the band. That
 * classified 16,550 shares of ABT, sized at the literal 100 against a 90.62
 * close, complete and written into the book, as `agrees` -- because 100 is
 * only 10% away from 90.62. The band could never separate the `|| 100`
 * fallback from a coincidence.
 *
 * The property below is the guard against that specific rewrite: no close,
 * anywhere in the plausible range, may make an exactly-100 trade look fine.
 */
import { describe, it, expect } from 'vitest'
import {
  assertReadOnly,
  readQueryBody,
  classifyTrade,
  isCorroborated,
  summarize,
  ALL_QUERIES,
  RECORDED,
  DEFAULT_BANDS,
  PLACEHOLDER_PRICE,
  // @ts-expect-error — plain .mjs script, no type declarations by design
} from '../../../../scripts/audit-trade-price-contamination.mjs'

type Row = {
  px: number
  ref_close: number | null
  delta_shares: number | null
  execution_status: string
}

const refuses = (query: string) => expect(() => assertReadOnly(query)).toThrow()
const accepts = (query: string) => expect(() => assertReadOnly(query)).not.toThrow()

describe('the audit cannot write', () => {
  it('accepts every query the script sends', () => {
    for (const [name, query] of Object.entries(ALL_QUERIES as Record<string, string>)) {
      expect(() => assertReadOnly(query), name).not.toThrow()
    }
  })

  it('refuses a bare write, in each verb', () => {
    refuses("update accepted_trades set price_at_acceptance = 90.62 where id = '1'")
    refuses("insert into accepted_trades (id) values ('1')")
    refuses('delete from accepted_trades')
    refuses('truncate accepted_trades')
  })

  it('refuses a write riding behind a legitimate read', () => {
    // The shape that matters most: the statement starts with SELECT, so a
    // prefix check alone would pass it.
    refuses('select count(*) from accepted_trades; delete from accepted_trades')
    refuses('select 1; update portfolio_holdings set price = 0')
  })

  it('refuses a write buried inside a CTE', () => {
    refuses("with x as (insert into assets (symbol) values ('X') returning id) select * from x")
    refuses('with x as (delete from accepted_trades returning id) select count(*) from x')
  })

  it('refuses DDL and privilege changes', () => {
    refuses('select 1; alter table accepted_trades drop column price_at_acceptance')
    refuses('select 1; drop table price_history_cache')
    refuses('select 1; grant all on accepted_trades to anon')
    refuses('select 1; revoke select on assets from authenticated')
    refuses('select 1; create table scratch (id int)')
  })

  it('strips comments before scanning, so uncommenting a write trips the guard', () => {
    // A commented-out write may sit in the file. What must not happen is
    // that someone uncomments it and the guard still passes, because the
    // keyword was only ever seen inside a comment.
    const withWrite = 'select 1 from assets /* staging */ delete from assets'
    refuses(withWrite)
    refuses('select 1 from assets\ndelete from assets -- oops')
  })

  it('does not false-positive on ordinary column and table names', () => {
    // `created_at` must not read as `create`, `updated_at` as `update`,
    // `settings` as `set`, `deleted_at` as `delete`.
    accepts('select created_at, updated_at, deleted_at from accepted_trades')
    accepts('select id from org_settings where created_at > now()')
    accepts('select price_at_acceptance from accepted_trades order by created_at desc limit 1')
    accepts('with ranked as (select row_number() over (order by date desc) as rn from price_history_cache) select * from ranked')
  })

  it('allows a trailing semicolon', () => {
    accepts('select 1 from assets;')
    accepts('select 1 from assets;   \n  ')
  })

  it('refuses the SELECT-shaped writes a review demonstrated', () => {
    // Each of these was ACCEPTED by the first version of the guard. None of
    // them contains a write keyword; they are all spelled as a SELECT.
    refuses('select * into stolen_trades from accepted_trades')
    refuses('select price_at_acceptance into audit_copy from accepted_trades')
    refuses("select setval('accepted_trades_id_seq', 1)")
    refuses("select nextval('accepted_trades_id_seq')")
    refuses('select pg_terminate_backend(1)')
    refuses('select pg_cancel_backend(1)')
    refuses("select pg_read_file('/etc/passwd')")
    refuses("select dblink_exec('dbname=x', 'delete from assets')")
  })

  it('does not false-positive on names that merely contain a banned word', () => {
    // `into` is the risky addition: it is a short word. Word boundaries keep
    // ordinary identifiers safe.
    accepts('select intonation from assets')
    accepts('select shares, cost from portfolio_holdings')
    accepts('select setvalue_label from org_settings_v')
  })

  it('refuses a banned word inside a string literal, and that is accepted', () => {
    // A known false positive, recorded rather than fixed. The guard scans raw
    // text and cannot tell a keyword from a literal, so a query that merely
    // mentions INTO is refused:
    refuses("select id from assets where symbol = 'INTO'")
    // Fixing it would mean parsing SQL in a guard whose whole job is to be
    // too simple to have bugs, and the failure direction is the safe one:
    // the audit refuses to run and a human looks. All five queries this
    // script actually sends are asserted above to pass, which is the case
    // that has to keep working.
  })
})

describe('the read-only transaction is the actual boundary', () => {
  // Proven against this project on 2026-11-07 with statements that are
  // harmless even if they run: `read_only: true` makes postgres answer
  //   update price_history_cache set symbol = symbol where false
  //   create temp table t (x int)
  //   select 1 as x into temp t
  // with SQLSTATE 25006, "cannot execute ... in a read-only transaction".
  // These tests pin the flag that asks for it.
  it('sets read_only on every request body', () => {
    for (const [name, query] of Object.entries(ALL_QUERIES as Record<string, string>)) {
      const body = readQueryBody(query) as { query: string; read_only: boolean }
      expect(body.read_only, name).toBe(true)
      expect(body.query, name).toBe(query)
    }
  })

  it('runs the tripwire before it will build a body at all', () => {
    // So a write cannot reach the network even once, read-only or not.
    expect(() => readQueryBody('update accepted_trades set price_at_acceptance = 1')).toThrow()
    expect(() => readQueryBody('select * into stolen_trades from accepted_trades')).toThrow()
  })
})

describe('classifying the price a trade was sized against', () => {
  it('reproduces the verdict recorded for each real row', () => {
    for (const row of RECORDED as Array<Row & { what: string; expect: string }>) {
      expect(classifyTrade(row), row.what).toBe(row.expect)
    }
  })

  it('never calls an exactly-100 trade `agrees`, at any close', () => {
    // The regression. A band-based rule passes this trade whenever the close
    // is within 25% of 100, which is precisely the ABT case.
    for (let close = 10; close <= 400; close += 0.5) {
      const verdict = classifyTrade({ px: PLACEHOLDER_PRICE, ref_close: close, delta_shares: 1, execution_status: 'complete' })
      expect(verdict, `close=${close}`).toBe('placeholder')
    }
  })

  it('reports corroboration separately, so a coincidence can still be triaged', () => {
    // Both are flagged; `corroborated` is what tells them apart by eye.
    const coincidence = { px: 100, ref_close: 99.4, delta_shares: 10, execution_status: 'pending' }
    const fallback = { px: 100, ref_close: 8.12, delta_shares: 10, execution_status: 'pending' }
    expect(classifyTrade(coincidence)).toBe('placeholder')
    expect(classifyTrade(fallback)).toBe('placeholder')
    expect(isCorroborated(coincidence)).toBe(true)
    expect(isCorroborated(fallback)).toBe(false)
  })

  it('separates a missing reference from a wrong one', () => {
    expect(classifyTrade({ px: 61.4, ref_close: null, delta_shares: 1, execution_status: 'pending' })).toBe('no_reference')
    expect(classifyTrade({ px: 228.5, ref_close: 332.89, delta_shares: 1, execution_status: 'pending' })).toBe('deviates')
  })

  it('refuses a non-positive price outright', () => {
    for (const px of [0, -1, Number.NaN]) {
      expect(classifyTrade({ px, ref_close: 100, delta_shares: 1, execution_status: 'pending' })).toBe('nonpositive')
    }
  })

  it('treats the band edges as inclusive of `agrees`', () => {
    const at = (ratio: number) => classifyTrade({ px: 100 * ratio, ref_close: 100, delta_shares: 1, execution_status: 'pending' })
    expect(at(DEFAULT_BANDS.high)).toBe('agrees')
    expect(at(DEFAULT_BANDS.low)).toBe('agrees')
    expect(at(DEFAULT_BANDS.high + 0.01)).toBe('deviates')
    expect(at(DEFAULT_BANDS.low - 0.01)).toBe('deviates')
  })
})

describe('what the audit says needs correcting', () => {
  // The two real trades outside the demo organisation, plus a pending one.
  const abt = { px: 100, ref_close: 90.62, delta_shares: 16550, execution_status: 'complete' }
  const aapl = { px: 228.5, ref_close: 332.89, delta_shares: 743, execution_status: 'complete' }
  const pending = { px: 100, ref_close: 50, delta_shares: 1000, execution_status: 'not_started' }
  const clean = { px: 284.78, ref_close: 284.78, delta_shares: 50, execution_status: 'complete' }

  it('counts only the trades that actually reached the book', () => {
    const s = summarize([abt, aapl, pending, clean])
    expect(s.flagged).toHaveLength(3)
    // `pending` is flagged but never applied, so it cannot have moved cash.
    expect(s.applied).toHaveLength(2)
  })

  it('computes the notional error from shares times the price gap', () => {
    const s = summarize([abt, aapl])
    // ABT: 16550 * (100 - 90.62) = +155,239
    // AAPL:   743 * (228.5 - 332.89) = -77,561.77
    expect(s.overstatedNotional).toBeCloseTo(155_239 - 77_561.77, 2)
    expect(s.impact(abt)!.booked).toBeCloseTo(1_655_000, 2)
    expect(s.impact(abt)!.correct).toBeCloseTo(1_499_761, 2)
  })

  it('reports no impact where there is no reference to compare against', () => {
    const s = summarize([{ px: 100, ref_close: null, delta_shares: -300000, execution_status: 'not_started' }])
    expect(s.impact(s.flagged[0])).toBeNull()
    // An unknown error must not be silently added as zero.
    expect(s.overstatedNotional).toBe(0)
  })

  it('leaves a clean corpus with nothing flagged', () => {
    const s = summarize([clean, clean])
    expect(s.flagged).toEqual([])
    expect(s.counts).toEqual({ agrees: 2 })
    expect(s.overstatedNotional).toBe(0)
  })
})
