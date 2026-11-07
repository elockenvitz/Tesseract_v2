/**
 * The price-validity gate at the shared accepted-trade write boundary.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The first version of this safeguard sat in `buildAcceptedTradeInput`, on
 * the Trade Lab path, and `bookable-price.test.ts` covers that. A review
 * measured what that actually protected and the answer was: not the paths
 * that produce trades.
 *
 *   production trades with a price            50
 *   of those created through the gated path    0
 *   both known-contaminated trades            ad hoc (ABT at a literal 100)
 *                                             and inbox (AAPL at 228.50)
 *
 * The gate now sits in `createAcceptedTrade`, which holds the only
 * `INSERT INTO accepted_trades` in the codebase, and which calls
 * `applyTradeToHoldings` -- the thing that moves shares and cash -- from
 * inside itself. Every path funnels through it: ad hoc, inbox, simulation,
 * batch promotion, correction and Trade Lab.
 *
 * Two kinds of assertion below, and both are needed.
 *
 * BEHAVIOURAL: feed `createAcceptedTrade` the exact input shape each caller
 * produces and check the verdict, including that a refusal reaches no
 * database call at all.
 *
 * STRUCTURAL: the claim "every path is covered" rests on there being exactly
 * one insert and on every call site passing provenance. Those are properties
 * of the source, so they are asserted against the source -- the same
 * reasoning as `holdings-apply-rpc.test.ts`. A seventh path added without
 * provenance, or a second insert added anywhere, fails these.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A Supabase stand-in that records every call and resolves an insert.
 *
 * `from` is a spy so a refusal can be asserted to have touched nothing: the
 * gate runs before the insert, so on a refused price this must stay unused.
 */
const calls: string[] = []
const insertedRows: Array<Record<string, unknown>> = []

vi.mock('../../supabase', () => {
  const chain = (table: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'lte', 'order', 'limit', 'update', 'delete']) {
      self[m] = (...a: unknown[]) => { calls.push(`${table}.${m}(${a.length})`); return self }
    }
    self.insert = (row: Record<string, unknown>) => {
      calls.push(`${table}.insert`)
      insertedRows.push(row)
      return self
    }
    // Index arithmetic rather than `.at(-1)`: this repo's tsconfig `lib` is
    // pre-es2022, so `.at` is a type error here.
    self.single = async () => ({
      data: { id: 'new-trade', ...insertedRows[insertedRows.length - 1] },
      error: null,
    })
    self.maybeSingle = async () => ({ data: null, error: null })
    return self
  }
  return {
    supabase: {
      from: vi.fn((table: string) => chain(table)),
      rpc: vi.fn(async () => {
        calls.push('rpc.apply_trade_to_holdings')
        return { data: { applied: false }, error: null }
      }),
    },
  }
})

import { createAcceptedTrade } from '../accepted-trade-service'

beforeEach(() => {
  calls.length = 0
  insertedRows.length = 0
})

/** The shape every caller builds, with a usable price and real provenance. */
const base = {
  portfolio_id: 'p1',
  asset_id: 'a1',
  action: 'buy' as const,
  accepted_by: 'u1',
  asset_symbol: 'AAPL',
  target_shares: 743,
  delta_shares: 743,
  price_at_acceptance: 332.89,
  price_basis: 'stored_close' as const,
  price_as_of: new Date().toISOString().slice(0, 10),
  source: 'inbox' as const,
}

const refusal = async (over: Record<string, unknown>) => {
  await expect(createAcceptedTrade({ ...base, ...over } as never)).rejects.toThrow(/Refusing to book/)
  // The whole point of a boundary: nothing reached the database.
  expect(calls).toEqual([])
}

// ───────────────────────────────────────────────────────────────────────────
// The four kinds of price the system has to tell apart
// ───────────────────────────────────────────────────────────────────────────

describe('a dated, valid market price', () => {
  it('books, ungated', async () => {
    const trade = await createAcceptedTrade(base as never)
    expect(trade.id).toBe('new-trade')
    expect(calls).toContain('accepted_trades.insert')
    expect(insertedRows[0]?.price_at_acceptance).toBe(332.89)
  })
})

describe('an outdated or unsourced number', () => {
  it('refuses the literal 100 with no provenance, which is the ABT trade', async () => {
    await refusal({ price_at_acceptance: 100, price_basis: null, price_as_of: null, asset_symbol: 'ABT' })
  })

  it('refuses a plausible price whose source was never recorded', async () => {
    await refusal({ price_basis: null })
  })

  it('refuses a priced trade with no date, which is the assets.current_price fall-through', async () => {
    await refusal({ price_as_of: null })
  })

  it('refuses a close from the October outage unless the caller allows a stale basis', async () => {
    await refusal({ price_as_of: '2026-10-01' })
  })

  it('leaves absent and non-positive prices to the database, which already refuses them', async () => {
    /*
     * The division of labour, and it is deliberate.
     *
     * `apply_trade_to_holdings` RAISEs on a null or non-positive price, so
     * nothing moves. The trade is still created, rests at `not_started`, and
     * carries the reason on `execution_note` -- the invariant this service
     * states throughout: a decision is never lost because it could not be
     * priced. Refusing here would delete the decision to prevent a write
     * that was already impossible.
     *
     * What this gate adds is the judgement SQL cannot make: whether a
     * POSITIVE number is a real price. 100.00 is positive. A five-month-old
     * mark is positive.
     */
    for (const price_at_acceptance of [null, 0, -12]) {
      calls.length = 0
      const trade = await createAcceptedTrade({ ...base, price_at_acceptance } as never)
      expect(trade.id, `price=${price_at_acceptance}`).toBe('new-trade')
      expect(calls, `price=${price_at_acceptance}`).toContain('accepted_trades.insert')
    }
  })
})

describe("the book's own carrying price", () => {
  const mark = { price_at_acceptance: 228.5, price_basis: 'book_mark' as const, price_as_of: null }

  it('is refused where the caller has not allowed a stale basis', async () => {
    // Trade Lab and the promote paths.
    await refusal(mark)
  })

  it('books where the caller has, and the gating is on the row', async () => {
    // accept-sizing's deliberate rule. `target = current + delta` only closes
    // when both sides are in the same money.
    const trade = await createAcceptedTrade({ ...base, ...mark, allow_stale_basis: true } as never)
    expect(trade.id).toBe('new-trade')
    expect(insertedRows[0]?.price_at_acceptance).toBe(228.5)
  })

  it('is STILL gated when the snapshot date looks current', async () => {
    /*
     * The self-disarm case, and the reason this is not just a renamed check.
     * `apply_trade_to_holdings` copies a book's prices forward onto today the
     * first time anything in it trades, so under the old rule one trade made
     * every mark in that book report a current price. 388 production marks
     * sit 50% or more from market and would all have read fresh.
     *
     * A mark is undated by construction now, so allowing it is always an
     * explicit choice.
     */
    const today = new Date().toISOString().slice(0, 10)
    await refusal({ ...mark, price_as_of: today })
  })
})

describe('a legitimately dated historical transaction', () => {
  it('is not blocked merely because its price is in the past', async () => {
    // A correction re-booking a June fill at June's close. `createCorrectionTrade`
    // defaults `allow_stale_basis` to true for exactly this.
    const trade = await createAcceptedTrade({
      ...base,
      source: 'adhoc',
      price_at_acceptance: 90.62,
      price_basis: 'stored_close',
      price_as_of: '2026-06-16',
      allow_stale_basis: true,
      corrects_accepted_trade_id: 'old-trade',
    } as never)
    expect(trade.id).toBe('new-trade')
    expect(insertedRows[0]?.corrects_accepted_trade_id).toBe('old-trade')
  })

  it('is still refused if that historical price has no source', async () => {
    // "It is old on purpose" is not a reason to stop asking where it came from.
    await refusal({ price_as_of: '2026-06-16', price_basis: null, allow_stale_basis: true })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// A decision without an execution is not a booking
// ───────────────────────────────────────────────────────────────────────────

describe('a trade with no share quantity', () => {
  it('is recorded, because nothing will move and the decision still happened', async () => {
    /*
     * `apply_trade_to_holdings` returns `applied: false` without writing when
     * both share columns are null, so there is no price to protect. Three of
     * the 53 production trades are this shape -- an Inbox accept that could
     * not be priced, an ad-hoc entry awaiting sizing. Refusing them would
     * lose the decision to guard a write that is not happening.
     */
    const trade = await createAcceptedTrade({
      portfolio_id: 'p1',
      asset_id: 'a1',
      action: 'buy',
      accepted_by: 'u1',
      source: 'adhoc',
      sizing_input: 'buy a little',
    } as never)
    expect(trade.id).toBe('new-trade')
    expect(calls).toContain('accepted_trades.insert')
  })

  it('is refused once it carries shares AND a positive unverifiable price', async () => {
    /*
     * The two things that together make a booking dangerous: a quantity to
     * move, and a number that looks like a price. Either alone is harmless --
     * no quantity means nothing moves, no price means the RPC refuses -- so
     * this is the exact shape the gate exists for, and it is the shape the
     * ABT trade had.
     */
    await expect(createAcceptedTrade({
      portfolio_id: 'p1',
      asset_id: 'a1',
      action: 'buy',
      accepted_by: 'u1',
      source: 'adhoc',
      asset_symbol: 'ABT',
      target_shares: 16550,
      price_at_acceptance: 100,
    } as never)).rejects.toThrow(/Refusing to book ABT/)
    expect(calls).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Structural: why "every path" is a claim this file can actually make
// ───────────────────────────────────────────────────────────────────────────

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
const service = src('lib/services/accepted-trade-service.ts')

describe('the gate sits where every path must pass', () => {
  it('there is exactly one INSERT INTO accepted_trades in the whole service', () => {
    /*
     * This is what makes coverage complete by construction rather than by
     * enumeration. Every other write to the table is an UPDATE of a row
     * `createAcceptedTrade` already created. If a second insert appears, the
     * gate no longer covers every path and this fails.
     */
    const inserts = service.match(/\.from\('accepted_trades'\)\s*\n?\s*\.insert\(/g) ?? []
    expect(inserts).toHaveLength(1)
  })

  it('the gate runs before that insert, not after it', () => {
    const gateAt = service.indexOf('assertTradePriceIsBookable(input)')
    const insertAt = service.search(/\.from\('accepted_trades'\)\s*\n?\s*\.insert\(/)
    expect(gateAt).toBeGreaterThan(-1)
    expect(insertAt).toBeGreaterThan(-1)
    expect(gateAt).toBeLessThan(insertAt)
  })

  it('every caller inside the service passes price provenance', () => {
    /*
     * The six production paths. A call site that forgets `price_basis` would
     * not fail to compile -- the field is optional, so a decision without
     * executable sizing still records -- but it WOULD refuse every priced
     * trade on that path at runtime. Catching it here is cheaper.
     *
     * `createAdHocAcceptedTrade` is the deliberate exception: it passes no
     * price and no shares, so there is nothing to vouch for.
     */
    const sites = service
      .split('createAcceptedTrade({')
      .slice(1)
      .map((s) => s.slice(0, s.indexOf('})')))

    // correction, inbox, promote, batch promote, ad hoc
    expect(sites).toHaveLength(5)

    // Every site that passes a price must also say where it came from.
    const priced = sites.filter((s) => s.includes('price_at_acceptance:'))
    expect(priced).toHaveLength(4)
    expect(priced.filter((s) => !s.includes('price_basis:'))).toEqual([])

    // And the one that does not is the ad hoc path, named rather than
    // silently excluded: it passes no price and no shares.
    const unpriced = sites.filter((s) => !s.includes('price_at_acceptance:'))
    expect(unpriced).toHaveLength(1)
    expect(unpriced[0]).toContain("source: 'adhoc'")
    expect(unpriced[0]).not.toContain('target_shares:')
    expect(unpriced[0]).not.toContain('delta_shares:')
  })

  it('the Trade Lab path passes provenance too', () => {
    const lab = src('lib/services/execute-sim-variants-service.ts')
    expect(lab).toContain('price_basis: computed?.price_basis')
    expect(lab).toContain('price_as_of: computed?.price_as_of')
  })

  it('applyTradeToHoldings is still called from inside the gated function', () => {
    /*
     * The gate protects the holdings write only because the holdings write is
     * downstream of it. Moving the apply out to the callers would put it
     * back outside the boundary.
     */
    const createStart = service.indexOf('export async function createAcceptedTrade')
    const createEnd = service.indexOf('export async function', createStart + 10)
    const body = service.slice(createStart, createEnd)
    expect(body).toContain('finalizeTradeForHoldingsSource')
    expect(service).toContain('await applyTradeToHoldings(')
  })
})

describe('accept-sizing no longer dates a mark with the snapshot date', () => {
  const acceptSizing = src('lib/decisions/accept-sizing.ts')

  it('passes no date for a book mark, on both basis builders', () => {
    /*
     * There are two places that build a `book_mark` basis --
     * `resolveAcceptSizingBasis` and `basisFromBook` -- and both used to pass
     * `totals.asOf`, the holdings snapshot date. Neither may now.
     */
    const marks = acceptSizing.match(/priceBasis: 'book_mark',[\s\S]{0,900}?priceAsOf: [^\n]+/g) ?? []
    expect(marks).toHaveLength(2)
    for (const m of marks) expect(m).toMatch(/priceAsOf: null/)
  })

  it('does not pass totals.asOf as a price date anywhere', () => {
    expect(acceptSizing).not.toMatch(/priceAsOf: totals\.asOf/)
  })
})
