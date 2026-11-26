/**
 * One request per symbol per window, however many surfaces ask.
 *
 * ── What this pins ────────────────────────────────────────────────────────
 *
 * The production Dashboard issued 46 `price_history_cache` requests on a cold
 * load for 37 overlapping symbol groups. The cause was not chunking -- that
 * is a row-cap guarantee and is left alone -- but a dozen independent hooks
 * each calling `fetchDailyCloses` with their own list and their own window.
 *
 * Every assertion below counts calls to an INJECTED fetcher, so "one request"
 * is measured rather than asserted about source text. The counter is proved
 * able to see more than one in `the counter is not blind` -- without that,
 * `toHaveBeenCalledTimes(1)` would pass just as happily against a fetcher
 * that was never wired up at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  coalescedCloses, __resetCoalescer, BATCH_MS, HOLD_MS,
  type ClosesFetcher,
} from '../closes-coalescer'
import type { DailyClose } from '../daily-closes'

/** A fetcher that answers with one dated close per symbol asked for. */
const rows = (symbols: readonly string[], date = '2026-11-14'): DailyClose[] =>
  symbols.map(symbol => ({ symbol, date, close: 100 }))

const spy = (impl?: ClosesFetcher) =>
  vi.fn<ClosesFetcher>(impl ?? (async syms => rows(syms)))

/** Past the batch window, with the promise jobs drained. */
const settle = () => new Promise(r => setTimeout(r, BATCH_MS + 15))

beforeEach(() => { __resetCoalescer() })
afterEach(() => { __resetCoalescer(); vi.useRealTimers() })

describe('callers that overlap share a request', () => {
  it('issues one request for the union of two concurrent callers', async () => {
    const fetcher = spy()

    const a = coalescedCloses(['AAPL', 'MSFT'], { days: 12 }, fetcher)
    const b = coalescedCloses(['MSFT', 'TGT'], { days: 12 }, fetcher)
    const [fromA, fromB] = await Promise.all([a, b])

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(new Set(fetcher.mock.calls[0][0])).toEqual(new Set(['AAPL', 'MSFT', 'TGT']))

    /* And each caller got ITS symbols -- not the union. A caller handed
       another surface's symbols would quietly widen every list on screen. */
    expect(fromA.map(r => r.symbol).sort()).toEqual(['AAPL', 'MSFT'])
    expect(fromB.map(r => r.symbol).sort()).toEqual(['MSFT', 'TGT'])
  })

  it('the counter is not blind', async () => {
    /*
     * NON-VACUITY. The assertions above would read identically against a
     * fetcher that is never called, or one wired to the wrong module. Two
     * callers asking for DIFFERENT windows cannot share a request -- the
     * shallow one would be handed rows it did not ask for -- so this must
     * observe exactly two.
     */
    const fetcher = spy()

    const a = coalescedCloses(['AAPL'], { days: 12 }, fetcher)
    const b = coalescedCloses(['AAPL'], { days: 400 }, fetcher)
    await Promise.all([a, b])

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.map(c => c[1].days).sort((x, y) => x - y)).toEqual([12, 400])
  })

  it('serves a later caller from what is held, with no request', async () => {
    const fetcher = spy()

    await coalescedCloses(['AAPL', 'MSFT'], { days: 12 }, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)

    /* Seconds later, a different surface wants a subset. This is the shape
       that produced the staggered duplicates: the callers never overlapped
       in a single tick, so a batch window alone would not have caught them. */
    const later = await coalescedCloses(['AAPL'], { days: 12 }, fetcher)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(later.map(r => r.symbol)).toEqual(['AAPL'])
  })

  it('answers a shallow window from a deep one already held', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const old = new Date(Date.now() - 300 * 86_400_000).toISOString().slice(0, 10)
    const fetcher = spy(async syms => [...rows(syms, old), ...rows(syms, today)])

    await coalescedCloses(['AAPL'], { days: 400 }, fetcher)
    const shallow = await coalescedCloses(['AAPL'], { days: 12 }, fetcher)

    expect(fetcher).toHaveBeenCalledTimes(1)
    /* Sliced to the window ASKED for: the 300-day-old row is not in a
       12-day answer, or a sparkline would draw a year into a fortnight. */
    expect(shallow.map(r => r.date)).toEqual([today])
  })

  it('does not answer a deep window from a shallow one', async () => {
    const fetcher = spy()

    await coalescedCloses(['AAPL'], { days: 12 }, fetcher)
    await coalescedCloses(['AAPL'], { days: 400 }, fetcher)

    /* The reverse of the case above, and the one that would silently
       truncate a year-long chart to a fortnight. */
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('records a symbol with no closes, so it is not asked for again', async () => {
    /* `price_history_cache` genuinely has no rows for some names. "No rows"
       is an answer; re-asking for it every time is how a missing symbol
       became a request on every surface that mentioned it. */
    const fetcher = spy(async syms => rows(syms.filter(s => s !== 'NOPE')))

    const first = await coalescedCloses(['AAPL', 'NOPE'], { days: 12 }, fetcher)
    expect(first.map(r => r.symbol)).toEqual(['AAPL'])

    await coalescedCloses(['NOPE'], { days: 12 }, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('what coalescing must not change', () => {
  it('passes the smallest chunk any caller asked for', async () => {
    /* The row-cap guarantee is the caller's, not this module's. Two callers
       on the same window with different chunk sizes must not have the
       smaller one widened -- that is exactly the silent truncation
       `fetchDailyCloses` sizes its requests to prevent. */
    const fetcher = spy()

    const a = coalescedCloses(['AAPL'], { days: 12, chunk: 80 }, fetcher)
    const b = coalescedCloses(['MSFT'], { days: 12, chunk: 5 }, fetcher)
    await Promise.all([a, b])

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].chunk).toBe(5)
  })

  it('fails every caller in a failed batch and holds nothing', async () => {
    const boom = new Error('PostgREST 500')
    const failing = spy(async () => { throw boom })

    const a = coalescedCloses(['AAPL'], { days: 12 }, failing)
    const b = coalescedCloses(['MSFT'], { days: 12 }, failing)
    await expect(a).rejects.toBe(boom)
    await expect(b).rejects.toBe(boom)

    /* Nothing was held, so the next caller tries again rather than
       inheriting a failure it never saw. */
    const ok = spy()
    const retry = await coalescedCloses(['AAPL'], { days: 12 }, ok)
    expect(ok).toHaveBeenCalledTimes(1)
    expect(retry.map(r => r.symbol)).toEqual(['AAPL'])
  })

  it('goes back to the network once the hold has expired', async () => {
    /*
     * The hold is a burst coalescer, NOT a cache: it must never stand in for
     * a caller's own staleTime. Past `HOLD_MS` the next ask is a real
     * request, which is what keeps freshness semantics where they were.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetcher = spy()

    await coalescedCloses(['AAPL'], { days: 12 }, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(HOLD_MS + 1_000)

    await coalescedCloses(['AAPL'], { days: 12 }, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('asks for nothing when asked for nothing', async () => {
    const fetcher = spy()
    expect(await coalescedCloses([], { days: 12 }, fetcher)).toEqual([])
    await settle()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
